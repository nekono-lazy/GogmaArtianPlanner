// Issue #154 Phase 2-C2.7-B post-hoc analysis only. Reads the run dir of a finished or interrupted run of
// run-planner-global-phase2c27b.mjs (start attestation, tasks record, units.jsonl, targets.jsonl, every unit record and task file; the raw
// output when it exists) and, as explicit file arguments AFTER the run ended, the population manifest, the Export, the B2-C2B1 / B2-C1 /
// B2-B1 RESULTs (population and authority chain), the 1,657 oracle RESULT and its manifest module. This is the only place the oracle is
// read: the oracle Routes are re-materialized here (materializeOracleRoutes(), checked byte for byte against the oracle RESULT) to get
// their candidateStableKey(); the policy side never sees any of it. It runs no unit and feeds nothing back. Stable keys are written as
// SHA-256 digests; raw keys stay in the .local records.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync, readFileSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { runDir: option('--run-dir'), targets: option('--targets'), export: option('--export'), b2c2b1: option('--b2c2b1-result'), b2c1: option('--b2c1-result'),
  b2b1: option('--b2b1-result'), oracle: option('--oracle'), manifest: option('--manifest'), oracleModule: option('--oracle-module'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c27b.mjs --run-dir <run dir> [--run <raw.json.local>] --targets <population manifest> --export <external.json> --b2c2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --oracle <1,657 oracle RESULT> --manifest <oracle manifest .ts> --oracle-module <oracle verifier .ts> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const runPath = option('--run')
const allowNonformal = args.includes('--allow-nonformal')
const sha = value => createHash('sha256').update(value).digest('hex')
const shaJson = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const json = file => JSON.parse(file.raw.toString('utf8'))
const lines = text => text.split(/\r?\n/).filter(Boolean)
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })
const median = values => { if (values.length === 0) return null; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const maxOf = values => values.length === 0 ? null : Math.max(...values)
const sum = values => values.reduce((a, b) => a + b, 0)

const [targetsFile, exportFile, b2c2b1File, b2c1File, b2b1File, oracleFile, manifestFile, oracleModuleFile] = await Promise.all([paths.targets, paths.export, paths.b2c2b1,
  paths.b2c1, paths.b2b1, paths.oracle, paths.manifest, paths.oracleModule].map(loadRaw))
const runFile = runPath ? await loadRaw(runPath) : null
const raw = runFile ? json(runFile) : null

// ---- the run dir journal (the authority for interrupted runs too)
const attestationPath = join(paths.runDir, 'start-attestation.json')
const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
const attestation = attestationFile ? json(attestationFile) : null
const tasksRecordPath = join(paths.runDir, 'tasks.record.json')
const tasksRecordFile = existsSync(tasksRecordPath) ? await loadRaw(tasksRecordPath) : null
const unitRows = existsSync(join(paths.runDir, 'units.jsonl')) ? lines(readFileSync(join(paths.runDir, 'units.jsonl'), 'utf8')).map(l => JSON.parse(l)) : []
const targetJournal = existsSync(join(paths.runDir, 'targets.jsonl')) ? lines(readFileSync(join(paths.runDir, 'targets.jsonl'), 'utf8')).map(l => JSON.parse(l)) : []
const rawConsistency = []
const recordCache = new Map()
for (const row of unitRows) {
  if (row.recordFile === null) { recordCache.set(row.unitId, null); continue }
  const path = join(paths.runDir, row.recordFile.file)
  if (!existsSync(path)) { rawConsistency.push(`${row.unitId}: the record file is missing`); recordCache.set(row.unitId, null); continue }
  const file = await loadRaw(path)
  if (file.source.sha256 !== row.recordFile.sha256 || file.source.bytes !== row.recordFile.bytes) rawConsistency.push(`${row.unitId}: the record file is not the one units.jsonl recorded`)
  recordCache.set(row.unitId, json(file))
}
const runStatus = raw === null ? 'interrupted' : raw.status
if (raw !== null) {
  if (!same(raw.units, unitRows)) rawConsistency.push('the raw units are not units.jsonl')
  if (!same(raw.targets.map(t => ({ ...t })), targetJournal)) rawConsistency.push('the raw Targets are not targets.jsonl')
  if (tasksRecordFile && raw.tasksChild?.recordFile?.sha256 !== tasksRecordFile.source.sha256) rawConsistency.push('the raw tasks record is not tasks.record.json')
  if (attestationFile && raw.launchAttestation?.sha256 !== attestationFile.source.sha256) rawConsistency.push('the raw launch attestation is not start-attestation.json')
}

// ---- provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C27BAnalysis.ts', 'scripts/analyze-planner-global-phase2c27b.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = attestation?.repositoryHead ?? null
if (measuredHead === null) throw new Error('No start attestation: the run has no launch provenance.')
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
let measuredHeadIsAncestor = true
try { execFileSync('git', ['merge-base', '--is-ancestor', measuredHead, 'HEAD']) } catch { measuredHeadIsAncestor = false }
const changedSinceMeasured = measuredHeadIsAncestor ? lines(git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths)) : []
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
const codeHash = createHash('sha256')
for (const file of lines(git('ls-tree', '-r', '--name-only', measuredHead, '--', ...codePaths))) { codeHash.update(file + '\0'); codeHash.update(gitBuffer('show', `${measuredHead}:${file}`)); codeHash.update('\0') }
const recomputedBenchmarkCodeSha256 = codeHash.digest('hex')
const analysisHead = git('rev-parse', 'HEAD')

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom', logLevel: 'error' })
try {
  const load = path => server.ssrLoadModule(path)
  const b = await load('/src/benchmarks/plannerGlobalPhase2C27B.ts')
  const bTargets = await load('/src/benchmarks/plannerGlobalPhase2C27BTargets.ts')
  const analysis = await load('/src/benchmarks/plannerGlobalPhase2C27BAnalysis.ts')
  const b2c1 = await load('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts')
  const b2c1Analysis = await load('/src/benchmarks/plannerGlobalPhase2C26B2C1Analysis.ts')
  const b2aAnalysis = await load('/src/benchmarks/plannerGlobalPhase2C26B2AAnalysis.ts')
  const c2aAnalysis = await load('/src/benchmarks/plannerGlobalPhase2C26B2C2AAnalysis.ts')
  const c2Analysis = await load('/src/benchmarks/plannerGlobalPhase2C2Analysis.ts')
  const research = await load('/src/benchmarks/plannerGlobalOptimizationResearch.ts')
  const runnerModule = await load('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts')
  const search = await load('/src/domain/search/index.ts')
  const common = await load('/src/domain/models/common.ts')
  const { ProductionRngEngine, PRODUCTION_RNG_ENGINE_VERSION } = await load('/src/domain/rng/production/productionRngEngine.ts')
  // The oracle verifier and manifest are analyzer arguments read after the run, never module paths of this script.
  const moduleOf = path => '/' + path.replace(/\\/g, '/').replace(/^\.?\//, '')
  const oracleModule = await load(moduleOf(paths.oracleModule))
  const manifestModule = await load(moduleOf(paths.manifest))
  const oracleRoutes = manifestModule.ORACLE_1657_ROUTES

  const invalidReasons = []
  const invalid = (prefix, issues) => invalidReasons.push(...issues.map(i => `${prefix}: ${i}`))
  invalid('raw_consistency', rawConsistency)

  // ---- 1. formal launch: the start attestation against independently obtained values
  const manifestParse = b.parsePhase2C27BTargetManifest(json(targetsFile))
  invalid('population_manifest', manifestParse.issues)
  const manifest = manifestParse.manifest
  const firstChildStartedAt = raw?.tasksChild?.process?.startedAt ?? null
  const attestationCheck = b.verifyPhase2C27BStartAttestation(attestation, { repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile.source.sha256,
    targetManifestSha256: targetsFile.source.sha256, targetWeaponIds: manifest?.targetWeaponIds ?? [], firstChildStartedAt })
  const formalLaunch = attestationCheck.verified
  if (!formalLaunch && !allowNonformal) throw new Error(`The run is not a formal launch: ${attestationCheck.issues.join('; ')}`)
  invalid('start_attestation', attestationCheck.issues)
  if (!measuredHeadIsAncestor) invalidReasons.push('provenance: the measured HEAD is not an ancestor of the analysis HEAD')
  invalid('provenance', calculationCodeChangedSinceMeasuredHead.map(p => `calculation code changed since the measured HEAD: ${p}`))
  if (analysisUncommitted) invalidReasons.push('provenance: uncommitted analysis code')
  // Production source changed files: none from the base main to the measured HEAD, and none to the analysis HEAD.
  const productionChangedToMeasured = b.phase2c27bProductionChangedFiles(lines(git('diff', '--name-only', b.PHASE2C27B_POLICY_AUTHORITY.baseMain, measuredHead)))
  const productionChangedToAnalysis = b.phase2c27bProductionChangedFiles(lines(git('diff', '--name-only', b.PHASE2C27B_POLICY_AUTHORITY.baseMain, analysisHead)))
  invalid('production_audit', [...productionChangedToMeasured.map(p => `changed before the measured HEAD: ${p}`), ...productionChangedToAnalysis.map(p => `changed before the analysis HEAD: ${p}`)])
  const policyDocumentSha256 = sha(gitBuffer('show', `${measuredHead}:${b.PHASE2C27B_POLICY_AUTHORITY.file}`))
  if (policyDocumentSha256 !== b.PHASE2C27B_POLICY_AUTHORITY.sha256) invalidReasons.push('policy_authority: the Phase 2-C2.7-A document at the measured HEAD is not the registered one')
  if (runStatus === 'smoke_cap_reached' || attestation?.smoke !== null) invalidReasons.push('launch: a smoke run')

  // ---- 2. the authority chain
  const populationParse = bTargets.parsePhase2C27BPopulationAuthorities({ b2c2b1Json: json(b2c2b1File), b2c2b1Sha256: b2c2b1File.source.sha256, b2c1Json: json(b2c1File), b2c1Sha256: b2c1File.source.sha256 })
  invalid('population_authority', populationParse.issues)
  const parsedB2B1 = b2c1Analysis.parsePhase2C26B2C1B2B1Authority(json(b2b1File), b2b1File.source.sha256)
  invalid('b2b1_authority', parsedB2B1.issues)
  const oracleParse = b2aAnalysis.parsePhase2C26B2AOracle(json(oracleFile))
  invalid('oracle', oracleParse.issues)
  const authorities = populationParse.authorities, b2b1Authority = parsedB2B1.authority, oracle = oracleParse.oracle
  if (!authorities || !b2b1Authority || !oracle || !manifest) {
    const decision = analysis.phase2c27bDecision({ invalidReasons, unmeasuredUnits: 0, requiredNotExecuted: 0, exactRecovered: 0, targets: 0 })
    await writeFile(paths.output, JSON.stringify({ phase: 'Issue #154 Phase 2-C2.7-B (post-hoc analysis)', analyzedAt: new Date().toISOString(), invalidReasons, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2C27B_INVALID: ${decision.reasons.join('; ')}`)
  }
  const manifestRoutesSha256 = shaJson(oracleRoutes)
  const { b2c2b1, b2c1: b2c1Authority } = authorities
  const hashChain = {
    b2c2b1Registered: b2c2b1File.source.sha256 === b.PHASE2C27B_POPULATION_AUTHORITY.b2c2b1ResultSha256,
    b2c1Registered: b2c1File.source.sha256 === b.PHASE2C27B_POPULATION_AUTHORITY.b2c1ResultSha256,
    b2c1MatchesB2C2B1: b2c1File.source.sha256 === b2c2b1.b2c1ResultSha256,
    b2b1MatchesB2C2B1: b2b1File.source.sha256 === b2c2b1.b2b1ResultSha256,
    b2b1MatchesB2C1: b2b1File.source.sha256 === b2c1Authority.b2b1ResultSha256,
    oracleMatchesB2C2B1: oracleFile.source.sha256 === b2c2b1.oracleResultSha256,
    oracleMatchesB2C1: oracleFile.source.sha256 === b2c1Authority.oracleResultSha256,
    oracleMatchesB2B1: oracleFile.source.sha256 === b2b1Authority.oracleResultSha256,
    manifestFileMatchesB2C2B1: manifestFile.source.sha256 === b2c2b1.oracleManifestFileSha256,
    manifestFileMatchesB2B1: manifestFile.source.sha256 === b2b1Authority.oracleManifestFileSha256,
    manifestRoutesMatchesB2C2B1: manifestRoutesSha256 === b2c2b1.oracleManifestRoutesSha256,
    manifestRoutesMatchesOracle: manifestRoutesSha256 === oracle.manifestSha256,
    exportMatchesB2C2B1: exportFile.source.sha256 === b2c2b1.exportSha256,
    exportMatchesB2C1: exportFile.source.sha256 === b2c1Authority.exportSha256,
    exportMatchesB2B1: exportFile.source.sha256 === b2b1Authority.exportSha256,
    exportMatchesOracle: exportFile.source.sha256 === oracle.exportSha256,
    exportMatchesManifest: exportFile.source.sha256 === manifest.exportSha256,
    manifestNamesB2C2B1: manifest.b2c2b1ResultSha256 === b2c2b1File.source.sha256,
    manifestNamesB2C1: manifest.b2c1ResultSha256 === b2c1File.source.sha256,
  }
  for (const [name, ok] of Object.entries(hashChain)) if (!ok) invalidReasons.push(`hash_chain: ${name}`)
  const oracleManifestCheck = b2aAnalysis.validatePhase2C26B2AOracleManifest(oracleRoutes, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  invalid('oracle_manifest', oracleManifestCheck.issues)

  // ---- 3. the population, re-derived mechanically; the manifest carries Target IDs only
  const population = bTargets.phase2c27bPopulation(authorities)
  invalid('population', population.issues)
  const expectedManifest = population.valid ? bTargets.phase2c27bTargetManifest(authorities) : null
  const populationParity = { manifestEqualsE1: expectedManifest !== null && same(expectedManifest, json(targetsFile)), manifestKeysAreTargetIdsOnly: manifestParse.valid,
    runnerTargetsEqualManifest: same(attestation.targetWeaponIds, manifest.targetWeaponIds), targets: manifest.targetWeaponIds.length, e1: b2c2b1.e1.length }
  if (!populationParity.manifestEqualsE1) invalidReasons.push('population: the manifest is not the mechanically derived E1 population')
  if (!populationParity.runnerTargetsEqualManifest) invalidReasons.push('population: the attested Targets are not the manifest Targets')

  // ---- 4. the schedule, re-derived from the Export, and the plans (P1 order and K <= 1 scope recomputed independently)
  const input = research.globalResearchInputFromExport(JSON.parse(exportFile.raw.toString('utf8')), b.PHASE2C27B_RESEARCH_MAX_PLAN_STEPS)
  const engine = new ProductionRngEngine()
  const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
  const scheduleConsistency = b2c1Analysis.validatePhase2C26B2C1Schedule(schedule)
  invalid('schedule', scheduleConsistency.issues)
  const b2b1Parity = b2c1Analysis.validatePhase2C26B2C1B2B1Parity(schedule, b2b1Authority, sha)
  invalid('b2b1_parity', b2b1Parity.issues)
  const rebuilt = b.buildPhase2C27BTargetPlans(schedule, manifest.targetWeaponIds)
  invalid('plans', rebuilt.issues)
  const tasksRecord = tasksRecordFile ? json(tasksRecordFile) : null
  const runnerPlans = tasksRecord?.result?.construction?.plans ?? null
  if (!same(runnerPlans, rebuilt.plans)) invalidReasons.push('plans: the runner plans are not the plans re-derived from the Export')
  // Independent P1: K0 first, then the registered lexicographic keys; the K <= 1 contexts must be the rank prefix, in this order.
  const p1Order = []
  for (const plan of rebuilt.plans) {
    const rows = schedule.contexts.filter(c => c.targetWeaponId === plan.targetWeaponId)
    const key = c => [c.targetEligibleMinCardinality, c.features.exclusiveOwnedWeaponCount, c.features.default.total.blocked, -c.features.default.total.shareableHeld]
    const sorted = [...rows].sort((x, y) => {
      if ((x.targetEligibleMinCardinality === 0) !== (y.targetEligibleMinCardinality === 0)) return x.targetEligibleMinCardinality === 0 ? -1 : 1
      const kx = key(x), ky = key(y)
      for (let i = 0; i < kx.length; i += 1) if (kx[i] !== ky[i]) return kx[i] - ky[i]
      return x.reservationDigest < y.reservationDigest ? -1 : x.reservationDigest > y.reservationDigest ? 1 : 0
    })
    const k1Prefix = sorted.filter(c => c.targetEligibleMinCardinality <= 1)
    const ok = same(k1Prefix.map(c => c.reservationDigest), plan.contexts.map(c => c.reservationDigest)) && same(sorted.slice(0, k1Prefix.length).map(c => c.reservationDigest), k1Prefix.map(c => c.reservationDigest))
      && same(plan.contexts.map(c => c.contextRank), plan.contexts.map((_, i) => i + 1))
    p1Order.push({ targetWeaponId: plan.targetWeaponId, contexts: plan.contexts.length, k0: plan.contexts.filter(c => c.cardinality === 0).length, k1: plan.contexts.filter(c => c.cardinality === 1).length, independentP1Matches: ok })
    if (!ok) invalidReasons.push(`p1: ${plan.targetWeaponId}: the K <= 1 contexts are not the independently recomputed P1 prefix`)
  }

  // ---- 5. the scheduler replay and every unit
  const recordOf = unitId => { const r = recordCache.get(unitId); return r ? r.result : null }
  const replay = analysis.phase2c27bReplay(rebuilt.plans, unitRows, recordOf, targetJournal)
  invalid('scheduler', replay.mismatches)
  const unitIssues = []
  const contextMismatches = []
  const conditionIssues = []
  const reservationViolations = []
  for (const target of replay.targets) for (const u of target.units) {
    const childRecord = recordCache.get(u.row.unitId)
    if (childRecord) {
      if (!same(childRecord.calculationContext, input.calculationContext)) conditionIssues.push(`${u.row.unitId}: CalculationContext differs`)
      if (childRecord.rngEngineVersion !== PRODUCTION_RNG_ENGINE_VERSION) conditionIssues.push(`${u.row.unitId}: RNG Engine version differs`)
      if (childRecord.researchMaxPlanSteps !== b.PHASE2C27B_RESEARCH_MAX_PLAN_STEPS) conditionIssues.push(`${u.row.unitId}: researchMaxPlanSteps differs`)
    }
    const taskPath = join(paths.runDir, `${u.row.unitId}.task.json`)
    if (!existsSync(taskPath) || !same(JSON.parse(readFileSync(taskPath, 'utf8')), u.task)) unitIssues.push(`${u.row.unitId}: the task file is not the scheduled task`)
    if (u.row.process.budgetMs !== b.PHASE2C27B_EXECUTION_ENVELOPE.unitBudgetMs) unitIssues.push(`${u.row.unitId}: the unit budget is not the registered envelope`)
    if (u.record?.status === 'context_mismatch') contextMismatches.push(`${u.row.unitId}: ${u.record.issues.join('/')}`)
    if (u.record?.status !== 'executed') continue
    unitIssues.push(...analysis.phase2c27bUnitIssues(u.task, u.record))
    const group = schedule.snapshot.reservationGroups[u.task.groupIndex]
    if (!group || !same(u.record.reservation, group.reservation)) unitIssues.push(`${u.row.unitId}: the unit reservation is not the schedule group reservation`)
    if (u.record.found) {
      const check = analysis.phase2c27bRouteReservationCheck(u.record.found.route, group.reservation)
      if (!check.respects || !u.record.found.reservationCheck.respects) reservationViolations.push(`${u.row.unitId}: found_R Route violates its reservation (${check.hits.join(',')})`)
      if (search.candidateStableKey({ ...u.record.found, route: u.record.found.route }) !== u.record.found.candidateStableKey) unitIssues.push(`${u.row.unitId}: the found Route does not hash to its stable key`)
    }
  }
  invalid('unit', unitIssues)
  invalid('context_rederivation', contextMismatches)
  invalid('conditions', conditionIssues)
  invalid('reservation', reservationViolations)
  if (input.options.maxPlanSteps !== runnerModule.PHASE2A_RESEARCH_MAX_PLAN_STEPS) invalidReasons.push('conditions: the Research maxPlanSteps is not the B2 series value')
  if (input.calculationContext.appSchemaVersion !== common.CURRENT_CALCULATION_APP_SCHEMA_VERSION) invalidReasons.push('conditions: CalculationContext schema version differs')
  const processCount = raw?.processes?.length ?? null
  if (raw !== null && processCount !== unitRows.length + 1) invalidReasons.push(`retry: ${processCount} child processes for ${unitRows.length} units + 1 tasks child (a retry or fallback)`)

  // ---- 6. the oracle (post-hoc only): re-materialized, checked against the oracle RESULT, then candidateStableKey()
  const rng = oracleModule.verifyOracleRng(input, engine, oracleRoutes)
  const materialization = await oracleModule.materializeOracleRoutes(input, engine, oracleRoutes, rng)
  const oracleJson = json(oracleFile)
  const oracleMaterialization = { passed: materialization.passed, entriesSha256Matches: shaJson(materialization.entries) === oracleJson.hashes.entriesSha256,
    candidateIdsMatch: materialization.targets.every(t => { const r = oracleJson.routes.find(x => x.targetWeaponId === t.targetWeaponId); return r && r.materialization.candidateId === t.candidateId && r.materialization.buildListEntryId === t.buildListEntryId }) }
  for (const [name, ok] of Object.entries(oracleMaterialization)) if (!ok) invalidReasons.push(`oracle_materialization: ${name}`)
  const oracleKeyOf = new Map(materialization.entries.map(e => [e.targetWeaponId, search.candidateStableKey(e.candidateSnapshot)]))

  // ---- 7. compatibility and covering rung (post-hoc authorities, cross-checked against B2-C1 / B2-C2B1)
  const reach = await c2aAnalysis.phase2c26b2c2aReach(schedule, manifest.targetWeaponIds, oracleRoutes, oracle)
  const b2c1Json = json(b2c1File), b2c2b1Json = json(b2c2b1File)
  const targetRows = []
  for (const target of replay.targets) {
    const id = target.targetWeaponId
    const r = reach.find(x => x.targetWeaponId === id)
    const c1 = b2c1Json.routes.find(x => x.targetWeaponId === id)
    const c2 = b2c2b1Json.routes.find(x => x.targetWeaponId === id)
    const authorityIssues = [...(r?.inconsistencies ?? ['no reach'])]
    const compatibleGroups = new Set(r?.compatibleGroupIndexes ?? [])
    const compatible = target.plan.contexts.filter(c => compatibleGroups.has(c.groupIndex))
    if (!c1 || r?.p1FirstCompatibleRank !== c1.firstCompatible.P1.rank) authorityIssues.push('the recomputed P1 first compatible rank is not B2-C1\'s')
    if (!c1 || compatible.filter(c => c.cardinality === 0).length !== c1.compatibleByCardinality['0'] || compatible.filter(c => c.cardinality === 1).length !== c1.compatibleByCardinality['1']) authorityIssues.push('the recomputed K0 / K1 compatible counts are not B2-C1\'s')
    const coveringRung = c2 ? analysis.phase2c27bCoveringRung(c2.required) : null
    if (!c2 || coveringRung !== c2.firstLadderRung) authorityIssues.push('the covering rung is not B2-C2B1\'s first ladder rung')
    invalid(`authority ${id}`, authorityIssues)
    const unitsOf = rank => target.units.filter(u => u.scheduled.contextRank === rank).map(u => ({ rung: u.scheduled.rung, result: u.result }))
    const verdicts = compatible.map(c => ({ contextRank: c.contextRank, cardinality: c.cardinality, verdict: analysis.phase2c27bContextVerdict(unitsOf(c.contextRank), coveringRung) }))
    const foundUnit = target.units.find(u => u.record?.status === 'executed' && u.record.outcome === 'found_R') ?? null
    const found = foundUnit?.record?.found ?? null
    const oracleKey = oracleKeyOf.get(id)
    const cls = analysis.phase2c27bTargetClass({ checkpointBlocked: target.plan.checkpointBlocked, stop: target.stop, foundStableKey: found?.candidateStableKey ?? null, oracleStableKey: oracleKey,
      verdicts: verdicts.map(v => v.verdict) })
    const executed = target.units.filter(u => u.record?.status === 'executed')
    const deliveredExact = executed.flatMap(u => u.record.deliveries.filter(d => d.stableKey === oracleKey).map(d => ({ unitId: u.row.unitId, rung: u.scheduled.rung, contextRank: u.scheduled.contextRank,
      deliveryIndex: d.deliveryIndex, action: d.action, trial: u.record.trials.find(t => t.deliveryIndex === d.deliveryIndex)?.verdict ?? null })))
    // Semantic cross-check (diagnostic): the Phase 2-C2 oracle matcher over the found Route summary.
    const semantic = found ? c2Analysis.phase2c2OracleCoverage([{ targetWeaponId: id, candidates: [{ stableKey: found.candidateStableKey, origin: 'alternative', summary: found.summary,
      provenance: [{ extentLabel: foundUnit.scheduled.rung }], kernelFound: false }] }], oracleJson).targets.find(x => x.targetWeaponId === id)?.coverage ?? null : null
    const finalStates = {}
    for (const s of target.contextStates) finalStates[s.state] = (finalStates[s.state] ?? 0) + 1
    const coveringIndex = coveringRung === null ? null : b.PHASE2C27B_RUNG_IDS.indexOf(coveringRung)
    targetRows.push({
      targetWeaponId: id, targetIndex: target.targetIndex, class: cls, checkpointBlocked: target.plan.checkpointBlocked,
      stop: target.stop, requiredNotExecuted: target.requiredNotExecuted?.unitId ?? null,
      found: found ? { unitId: foundUnit.row.unitId, rung: foundUnit.scheduled.rung, contextRank: foundUnit.scheduled.contextRank, cardinality: foundUnit.task.cardinality,
        stableKeySha256: sha(found.candidateStableKey), generatedSelected: found.generatedSelected, deliveryIndex: found.deliveryIndex, trialOrdinal: found.trialOrdinal,
        routeKind: found.route.kind, sourceKind: found.summary.sourceKind, estimatedOperationCount: found.estimatedOperationCount, operationTypes: found.summary.operationTypes,
        exactOracle: found.candidateStableKey === oracleKey, semanticOracleCoverage: semantic } : null,
      oracle: { stableKeySha256: oracleKey ? sha(oracleKey) : null, coveringRung, p1FirstCompatibleRank: r?.p1FirstCompatibleRank ?? null,
        compatibleK0: compatible.filter(c => c.cardinality === 0).length, compatibleK1: compatible.filter(c => c.cardinality === 1).length },
      compatibleContextVerdicts: verdicts,
      exactDeliveredButNotFound: cls !== 'exact_recovered' && deliveredExact.length > 0, exactDeliveries: deliveredExact,
      contextFinalStates: finalStates,
      units: { total: target.units.length, byRung: Object.fromEntries(b.PHASE2C27B_RUNG_IDS.map(rung => [rung, target.units.filter(u => u.scheduled.rung === rung).length])),
        measured: target.units.filter(u => u.result.measured).length, unmeasured: target.units.filter(u => !u.result.measured).length,
        coveringRungUnits: coveringIndex === null ? 0 : target.units.filter(u => b.PHASE2C27B_RUNG_IDS.indexOf(u.scheduled.rung) >= coveringIndex).length },
      trials: { total: sum(executed.map(u => u.record.trials.length)), fullRuns: sum(executed.map(u => u.record.trials.reduce((s, t) => s + t.fullRunsStarted, 0))),
        verdicts: executed.flatMap(u => u.record.trials.map(t => t.verdict.status === 'rejected' ? `rejected:${t.verdict.reason}` : t.verdict.status)).reduce((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {}),
        skippedPreviouslyRejected: sum(executed.map(u => u.record.skippedPreviouslyRejected.length)) },
      escalation: analysis.phase2c27bEscalationDiagnostics(target.units),
      wallMs: sum(target.units.map(u => u.row.process.wallMs)),
    })
  }

  // ---- 8. execution completeness, classes, decision
  const allUnits = replay.targets.flatMap(t => t.units)
  const unmeasured = allUnits.filter(u => !u.result.measured)
  const requiredNotExecuted = replay.targets.filter(t => t.requiredNotExecuted !== null)
  const exactRecovered = targetRows.filter(t => t.class === 'exact_recovered').length
  const classCounts = Object.fromEntries(analysis.PHASE2C27B_TARGET_CLASSES.map(c => [c, targetRows.filter(t => t.class === c).length]))
  const decision = analysis.phase2c27bDecision({ invalidReasons, unmeasuredUnits: unmeasured.length, requiredNotExecuted: requiredNotExecuted.length, exactRecovered, targets: targetRows.length })
  const outcomeCounts = rung => Object.fromEntries([...b.PHASE2C27B_UNIT_OUTCOMES, 'timeout', 'out_of_memory', 'process_failure', 'context_mismatch', 'interrupted'].map(k =>
    [k, allUnits.filter(u => u.scheduled.rung === rung && (u.result.measured ? u.result.outcome === k : u.result.reason === k)).length]))
  const peak = u => { const m = recordCache.get(u.row.unitId)?.memory; return { heap: Math.max(m?.sampledMaxHeapUsedBytes ?? 0, u.row.lastIpcMemory?.maxHeapUsedBytes ?? 0),
    rss: Math.max(m?.sampledMaxRssBytes ?? 0, (m?.maxRssKiB ?? 0) * 1024, u.row.lastIpcMemory?.maxRssBytes ?? 0) } }
  const executedAll = allUnits.filter(u => u.record?.status === 'executed')
  const aggregates = {
    units: allUnits.length, measured: allUnits.length - unmeasured.length, unmeasured: unmeasured.length, requiredNotExecuted: requiredNotExecuted.length,
    byRung: Object.fromEntries(b.PHASE2C27B_RUNG_IDS.map(rung => [rung, { units: allUnits.filter(u => u.scheduled.rung === rung).length, outcomes: outcomeCounts(rung) }])),
    unmeasuredByReason: unmeasured.reduce((a, u) => ({ ...a, [u.result.reason]: (a[u.result.reason] ?? 0) + 1 }), {}),
    stops: targetRows.reduce((a, t) => { const k = t.stop?.stopReason ?? 'not_stopped'; return { ...a, [k]: (a[k] ?? 0) + 1 } }, {}),
    classCounts, exactRecovered, exactRecoveredOf: targetRows.length,
    trials: { total: sum(targetRows.map(t => t.trials.total)), fullRuns: sum(targetRows.map(t => t.trials.fullRuns)) },
    contextsReachingTrialBound: sum(targetRows.map(t => t.contextFinalStates.candidate_trial_bound_reached ?? 0)),
    contextsReachingRerunBound: sum(targetRows.map(t => t.contextFinalStates.planner_rerun_bound_reached ?? 0)),
    contextsClosed: sum(targetRows.map(t => t.contextFinalStates.closed ?? 0)),
    contextsUnmeasured: sum(targetRows.map(t => t.contextFinalStates.unmeasured ?? 0)),
    extentEscalations: allUnits.filter(u => u.scheduled.rung !== 'L0').length,
    escalationSupersetViolations: sum(targetRows.map(t => t.escalation.violations)),
    reservationViolations: reservationViolations.length,
    timing: { totalUnitWallMs: sum(allUnits.map(u => u.row.process.wallMs)), runWallMs: raw?.wallMs ?? null, medianUnitWallMs: median(allUnits.map(u => u.row.process.wallMs)),
      maxUnitWallMs: maxOf(allUnits.map(u => u.row.process.wallMs)), searchOnlyMsTotal: sum(executedAll.map(u => u.record.timing.searchOnlyMs)),
      trialMsTotal: sum(executedAll.map(u => u.record.timing.trialMs)) },
    memory: { peakHeapBytes: maxOf(allUnits.map(u => peak(u).heap)), peakRssBytes: maxOf(allUnits.map(u => peak(u).rss)), medianPeakHeapBytes: median(allUnits.map(u => peak(u).heap)) },
  }
  const unitRowsOut = allUnits.map(u => ({ unitId: u.row.unitId, targetIndex: u.row.targetIndex, contextRank: u.scheduled.contextRank, rung: u.scheduled.rung,
    cardinality: u.task.cardinality, result: u.result.measured ? u.result.outcome : `unmeasured:${u.result.reason}`, process: u.row.process.outcome, wallMs: u.row.process.wallMs,
    ladderStateAtStart: { candidateTrialsUsed: u.scheduled.ladderStateAtStart.candidateTrialsUsed, plannerRerunsUsed: u.scheduled.ladderStateAtStart.plannerRerunsUsed,
      previouslyRejectedSha256: u.scheduled.ladderStateAtStart.previouslyRejectedCandidateStableKeys.map(sha) },
    ladderStateAtEnd: u.result.measured ? { candidateTrialsUsed: u.result.ladderStateAtEnd.candidateTrialsUsed, plannerRerunsUsed: u.result.ladderStateAtEnd.plannerRerunsUsed,
      remainingCandidateTrials: b.phase2c27bRemaining(u.result.ladderStateAtEnd).remainingCandidateTrials, remainingPlannerReruns: b.phase2c27bRemaining(u.result.ladderStateAtEnd).remainingPlannerReruns,
      previouslyRejectedSha256: u.result.ladderStateAtEnd.previouslyRejectedCandidateStableKeys.map(sha) } : null,
    search: u.record?.status === 'executed' ? { ...u.record.search, searchOnlyMs: u.record.timing.searchOnlyMs, trialMs: u.record.timing.trialMs } : null,
    deliveries: u.record?.status === 'executed' ? u.record.deliveries.map(d => ({ i: d.deliveryIndex, keySha256: sha(d.stableKey), cost: d.estimatedOperationCount, action: d.action,
      respectsReservation: d.reservationCheck.respects })) : null,
    trials: u.record?.status === 'executed' ? u.record.trials.map(t => ({ ordinal: t.trialOrdinal, delivery: t.deliveryIndex, keySha256: sha(t.candidateStableKey), preflight: t.preflight,
      fullRuns: t.fullRunsStarted, verdict: t.verdict, run: t.run === null ? null : { planPresent: t.run.planPresent, termination: t.run.termination.status, steps: t.run.stepCount,
        selected: t.run.selectedCount, conflicts: t.run.conflictCount, generatedSelected: t.run.generatedSelected, supportNotSelected: t.run.supportNotSelected.length,
        generatedConflictsWithSupport: t.run.generatedConflictsWithSupport, generatedCommitment: t.run.generatedCommitment?.status ?? null }, elapsedMs: t.elapsedMs })) : null,
    peakHeapBytes: peak(u).heap, peakRssBytes: peak(u).rss }))

  const result = {
    phase: 'Issue #154 Phase 2-C2.7-B: E1 oracle-free execution of the Phase 2-C2.7-A pre-registered policy (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile?.source ?? null, runDir: basename(paths.runDir), attestation: attestationFile?.source ?? null, tasksRecord: tasksRecordFile?.source ?? null,
      targets: targetsFile.source, export: { file: exportFile.source.file, bytes: exportFile.source.bytes, sha256: exportFile.source.sha256, committed: false },
      b2c2b1: b2c2b1File.source, b2c1: b2c1File.source, b2b1: b2b1File.source, oracle: oracleFile.source, oracleManifest: manifestFile.source, oracleModule: oracleModuleFile.source,
      unitRecords: unitRows.map(u => u.recordFile).filter(Boolean) },
    provenance: { formal: formalLaunch && decision.case !== 'B2C27B_INVALID' && runStatus === 'completed', measuredHead, analysisHead, measuredHeadIsAncestor, runStatus,
      benchmarkCodeSha256: recomputedBenchmarkCodeSha256, calculationCodeChangedSinceMeasuredHead, analysisCodeUncommitted: analysisUncommitted,
      productionChangedFiles: { toMeasuredHead: productionChangedToMeasured, toAnalysisHead: productionChangedToAnalysis }, policyDocumentSha256,
      startAttestation: { sha256: attestationFile?.source.sha256 ?? null, verified: attestationCheck.verified, issues: attestationCheck.issues, body: attestation },
      ...b.PHASE2C27B_PROVENANCE_FLAGS, oracleReadOnlyByAnalyzer: true, oracleStableKeyAuthority: 'materializeOracleRoutes() re-run post hoc, byte-equal to the oracle RESULT entries' },
    environment: raw?.environment ?? null,
    conditions: { ...b.phase2c27bRegisteredConditions(), calculationContext: input.calculationContext, rngEngineVersion: PRODUCTION_RNG_ENGINE_VERSION },
    hashChain, oracleMaterialization, populationParity, p1Order,
    decisionRule: [...b.PHASE2C27B_DECISION_RULE],
    aggregates, targets: targetRows, units: unitRowsOut,
    invalidReasons, decision,
  }
  await writeFile(paths.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), decision, classCounts, exactRecovered, units: aggregates.units, unmeasured: aggregates.unmeasured,
    requiredNotExecuted: aggregates.requiredNotExecuted, invalid: invalidReasons.length }, null, 2))
} finally {
  await server.close()
}
