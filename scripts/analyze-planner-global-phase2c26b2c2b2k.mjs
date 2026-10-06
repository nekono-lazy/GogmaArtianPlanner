// Issue #154 Phase 2-C2.6-B2-C2B2K post-hoc analysis only. Reads the finished B2-C2B2K raw run, its child record, its memory log and
// its runner start attestation (written by run-planner-global-phase2c26b2c2b2k.mjs) and, as explicit file arguments AFTER the run ended,
// the probe manifest, the Export (to re-derive the unchanged B2-C1 schedule), the B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C /
// B2-C2B2D RESULTs (the authority chain B2-C2B2E read), the B2-C2B2E RESULT (the population source and the paired before authority of
// the same Search input and execution conditions) with its local raw evidence, the B2-C2B2I / B2-C2B2J RESULTs (the authority of the
// optimized Production state) and the 1,657 oracle RESULT plus manifest (post-hoc reservation compatibility and the exact judgement).
// It runs no Search, no kernel and no Planner, and feeds no evidence into any calculation. Candidate stable keys are written as SHA-256
// digests; the raw keys stay in the .local records.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync, readFileSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { run: option('--run'), runDir: option('--run-dir'), probes: option('--probes'), export: option('--export'), b2c2b1: option('--b2c2b1-result'), b2c1: option('--b2c1-result'),
  b2b1: option('--b2b1-result'), b2c2b2b: option('--b2c2b2b-result'), b2c2b2c: option('--b2c2b2c-result'), b2c2b2d: option('--b2c2b2d-result'), b2c2b2e: option('--b2c2b2e-result'),
  b2c2b2i: option('--b2c2b2i-result'), b2c2b2j: option('--b2c2b2j-result'), b2c2b2eRaw: option('--b2c2b2e-raw'), b2c2b2eRunDir: option('--b2c2b2e-run-dir'),
  b2c2b2eProbes: option('--b2c2b2e-probes'), oracle: option('--oracle'), manifest: option('--manifest'), output: option('--output') }
if (Object.values(paths).some(value => !value)) {
  throw new Error('Usage: node --max-old-space-size=8192 scripts/analyze-planner-global-phase2c26b2c2b2k.mjs --run <raw.json.local> --run-dir <run dir> --probes <probe manifest> --export <external.json> --b2c2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B1_RESULT.json --b2c1-result docs/PLANNER_GLOBAL_PHASE2C26B2C1_RESULT.json --b2b1-result docs/PLANNER_GLOBAL_PHASE2C26B2B1_RESULT.json --b2c2b2b-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2B_RESULT.json --b2c2b2c-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2C_RESULT.json --b2c2b2d-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2D_RESULT.json --b2c2b2e-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json --b2c2b2i-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json --b2c2b2j-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2J_RESULT.json --b2c2b2e-raw <B2-C2B2E raw> --b2c2b2e-run-dir <B2-C2B2E run dir> --b2c2b2e-probes <B2-C2B2E probe manifest> --oracle docs/PLANNER_GLOBAL_1657_ORACLE_RESULT.json --manifest <oracle manifest .ts> --output <new.json> [--monitor-log <operator machine monitor log>] [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
const sha = text => createHash('sha256').update(text).digest('hex')
const loadRaw = async path => { const raw = await readFile(path); return { raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const [runFile, probesFile, exportFile, b2c2b1File, b2c1File, b2b1File, b2c2b2bFile, b2c2b2cFile, b2c2b2dFile, b2c2b2eFile, b2c2b2iFile, b2c2b2jFile, oracleFile, manifestFile] = await Promise.all([
  paths.run, paths.probes, paths.export, paths.b2c2b1, paths.b2c1, paths.b2b1, paths.b2c2b2b, paths.b2c2b2c, paths.b2c2b2d, paths.b2c2b2e, paths.b2c2b2i, paths.b2c2b2j, paths.oracle,
  paths.manifest].map(loadRaw))
const json = file => JSON.parse(file.raw.toString('utf8'))
const r = json(runFile)
const allowNonformal = args.includes('--allow-nonformal')
// Optional: the operator's machine monitor log of the run (one line per minute: free memory, CPU load, encoder processes). An
// observation of the environment only, never a decision input and never a reason to re-run.
const monitorPath = option('--monitor-log')
const lines = text => text.split(/\r?\n/).filter(Boolean)

// Provenance: only the post-hoc analysis code (and tests) may change after the measured HEAD.
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })
const analysisPaths = ['src/benchmarks/plannerGlobalPhase2C26B2C2B2KAnalysis.ts', 'scripts/analyze-planner-global-phase2c26b2c2b2k.mjs']
const analysisUncommitted = Boolean(git('diff', 'HEAD', '--', ...analysisPaths) || git('ls-files', '--others', '--exclude-standard', '--', ...analysisPaths))
if (analysisUncommitted && !allowNonformal) throw new Error('Commit the post-hoc analysis code before regenerating evidence (or pass --allow-nonformal).')
const measuredHead = r.environment.repositoryHead
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changedSinceMeasured = lines(git('diff', '--name-only', measuredHead, 'HEAD', '--', ...codePaths))
const calculationCodeChangedSinceMeasuredHead = changedSinceMeasured.filter(path => !analysisPaths.includes(path) && !path.endsWith('.test.ts'))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
let measuredHeadIsAncestor = true
try { execFileSync('git', ['merge-base', '--is-ancestor', measuredHead, 'HEAD']) } catch { measuredHeadIsAncestor = false }
// The benchmark code SHA-256 of the measured HEAD, recomputed from its git objects by the runner rule (independent of the raw).
const codeHash = createHash('sha256')
for (const file of lines(git('ls-tree', '-r', '--name-only', measuredHead, '--', ...codePaths))) {
  codeHash.update(file + '\0'); codeHash.update(gitBuffer('show', `${measuredHead}:${file}`)); codeHash.update('\0')
}
const recomputedBenchmarkCodeSha256 = codeHash.digest('hex')
const smoke = r.environment.smoke !== null
const formalRunConditions = r.status === 'completed' && !smoke && measuredHeadIsAncestor
if (!formalRunConditions && !allowNonformal) throw new Error('The raw run is not a formal run (smoke option, not completed, or a measured HEAD outside this history).')
if (r.status !== 'completed') throw new Error(`The raw run did not complete (${r.status}).`)

const stream = s => s === null ? null : { first: s.first, last: s.last, operations: s.operations, positions: s.positions, crossesHeldPositions: s.crossesHeldPositions, startsAfterOrigin: s.startsAfterOrigin }
const compactCandidate = c => c === null || c === undefined ? null : { deliveryIndex: c.deliveryIndex, stableKeySha256: sha(c.stableKey), orderingKeys: c.orderingKeys,
  respectsReservation: c.reservationCheck.respects, routeKind: c.summary.routeKind, sourceKind: c.summary.sourceKind, estimatedOperationCount: c.summary.estimatedOperationCount,
  estimatedAdvances: c.summary.estimatedAdvances, operationTypes: c.summary.operationTypes, normal: stream(c.summary.normal), gogma: stream(c.summary.gogma), skill: stream(c.summary.skill),
  heldRoute: c.summary.heldRoute }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const k = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2K.ts')
  const kTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2KTargets.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2KAnalysis.ts')
  const c2b2e = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2E.ts')
  const c2b2d = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2D.ts')
  const eTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ETargets.ts')
  const d2Targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2DTargets.ts')
  const c2b2cTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2CTargets.ts')
  const e1Targets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2ATargets.ts')
  const c2aTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2ATargets.ts')
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

  // The B2-C2B2K authorities (B2-C2B2E / B2-C2B2I / B2-C2B2J), re-read here; nothing the runner wrote is trusted for them.
  const invalidReasons = []
  const eParsed = kTargets.parsePhase2C26B2C2B2KB2C2B2EAuthority(json(b2c2b2eFile), b2c2b2eFile.source.sha256)
  if (!eParsed.valid) invalidReasons.push(...eParsed.issues.map(i => `b2c2b2e_authority: ${i}`))
  const iParsed = kTargets.parsePhase2C26B2C2B2KB2C2B2IAuthority(json(b2c2b2iFile), b2c2b2iFile.source.sha256)
  if (!iParsed.valid) invalidReasons.push(...iParsed.issues.map(i => `b2c2b2i_authority: ${i}`))
  const jParsed = kTargets.parsePhase2C26B2C2B2KB2C2B2JAuthority(json(b2c2b2jFile), b2c2b2jFile.source.sha256)
  if (!jParsed.valid) invalidReasons.push(...jParsed.issues.map(i => `b2c2b2j_authority: ${i}`))
  const facts = eParsed.facts
  const adoptedOptimizations = iParsed.authority && jParsed.authority ? kTargets.phase2c26b2c2b2kAdoptedOptimizations(iParsed.authority, jParsed.authority) : []
  // The B2-C2B2E raw evidence, hashed again here (each must be the file the B2-C2B2E RESULT recorded).
  const evidence = {}
  for (const name of kTargets.PHASE2C26B2C2B2K_B2C2B2E_EVIDENCE) {
    const recorded = facts?.evidence[name] ?? null
    const path = name === 'run' ? paths.b2c2b2eRaw : name === 'probeManifest' ? paths.b2c2b2eProbes : join(paths.b2c2b2eRunDir, recorded?.file ?? 'start-attestation.json')
    const local = existsSync(path) ? sha(readFileSync(path)) : null
    evidence[name] = { file: basename(path), recordedSha256: recorded?.sha256 ?? null, localSha256: local, matches: recorded !== null && basename(path) === recorded.file && local === recorded.sha256 }
    if (!evidence[name].matches) invalidReasons.push(`b2c2b2e_evidence: ${name}: the local file is not the one the B2-C2B2E RESULT recorded`)
  }

  // Launch provenance (evidence grade) is a separate axis from the Search decision: the runner start attestation of the run dir,
  // verified against independently obtained values. --allow-nonformal only lets a non-formal RESULT be written.
  const probeManifestParse = k.parsePhase2C26B2C2B2KProbeManifest(json(probesFile))
  const attestationPath = join(paths.runDir, k.PHASE2C26B2C2B2K_START_ATTESTATION_FILE)
  const attestationFile = existsSync(attestationPath) ? await loadRaw(attestationPath) : null
  const launchProvenance = analysis.phase2c26b2c2b2kLaunchProvenance({
    attestationFile: attestationFile === null ? null : { sha256: attestationFile.source.sha256, body: json(attestationFile) },
    recordedAttestationSha256: r.launchAttestation?.sha256 ?? null, environment: r.environment,
    expected: { repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256, exportSha256: exportFile.source.sha256, probeManifestSha256: probesFile.source.sha256,
      b2c2b2eResultSha256: kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2E.resultSha256, b2c2b2iResultSha256: kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2I.resultSha256,
      b2c2b2jResultSha256: kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.resultSha256, b2c2b2eEvidence: facts?.evidence ?? {}, adoptedOptimizations,
      b2c2b2eMeasuredHead: eParsed.authority?.measuredHead ?? '', probes: probeManifestParse.manifest?.probes ?? [], expectedTaskIdentities: probeManifestParse.manifest?.expectedTaskIdentities ?? [],
      firstChildStartedAt: r.tasksChild?.process?.startedAt ?? null } })
  if (!launchProvenance.verified && !allowNonformal) throw new Error(`The launch provenance is not verified (${launchProvenance.reason}); pass --allow-nonformal for a non-formal RESULT.`)
  const formalConditions = formalRunConditions && calculationCodeChangedSinceMeasuredHead.length === 0 && !analysisUncommitted
  const formal = formalConditions && launchProvenance.verified
  const evidenceGrade = analysis.phase2c26b2c2b2kEvidenceGrade({ formalConditions, launchProvenanceVerified: launchProvenance.verified, partialRun: false })
  // A present attestation whose integrity fails is an invalid run; an absent one, or one truthfully attesting a non-formal launch, only makes the evidence non-formal.
  if (attestationFile !== null) invalidReasons.push(...launchProvenance.integrityIssues.map(i => `start_attestation: ${i}`))

  // The Production audit, recomputed here from git at the measured HEAD (never from the raw): no Production change by this phase, and
  // exactly the adopted optimizations since B2-C2B2E's measured HEAD, each byte-identical to its formal measured file.
  const b2c2b2eMeasuredHead = eParsed.authority?.measuredHead ?? null
  const baseMain = k.PHASE2C26B2C2B2K_BASE_MAIN.sha
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, measuredHead]) } catch { baseMainIsAncestor = false }
  const productionAudit = b2c2b2eMeasuredHead === null ? null : (() => {
    const forkPoint = git('merge-base', b2c2b2eMeasuredHead, baseMain)
    return { b2c2b2eMeasuredHead,
      productionChangedSinceB2C2B2E: kTargets.phase2c26b2c2b2kProductionChangedFiles(lines(git('diff', '--name-only', b2c2b2eMeasuredHead, measuredHead, '--', ...codePaths))),
      adoptedOptimizationFiles: [...new Set(adoptedOptimizations.flatMap(o => o.files))].sort(),
      productionChangedSinceBaseMain: kTargets.phase2c26b2c2b2kProductionChangedFiles(lines(git('diff', '--name-only', baseMain, measuredHead, '--', ...codePaths))),
      baseMainIsAncestor,
      mainCommits: lines(git('log', '--first-parent', '--reverse', '--format=%H%x09%s', `${forkPoint}..${baseMain}`)).map(line => {
        const [commit, ...subject] = line.split('\t')
        return { sha: commit, subject: subject.join('\t'), productionChangedFiles: kTargets.phase2c26b2c2b2kProductionChangedFiles(lines(git('diff-tree', '--no-commit-id', '--name-only', '-r', commit))) }
      }),
      optimizedFilesEqualMeasured: kTargets.phase2c26b2c2b2kOptimizedFileHeads(adoptedOptimizations).map(({ file, measuredHead: head }) => ({ file, measuredHead: head,
        equal: sha(gitBuffer('show', `${head}:${file}`)) === sha(gitBuffer('show', `${measuredHead}:${file}`)) })) }
  })()
  const auditIssues = productionAudit === null ? ['no B2-C2B2E measured HEAD'] : kTargets.phase2c26b2c2b2kProductionAuditIssues(productionAudit, adoptedOptimizations, b2c2b2eMeasuredHead)
  invalidReasons.push(...auditIssues.map(i => `production_audit: ${i}`))
  const productionAuditMatchesRunner = JSON.stringify(productionAudit) === JSON.stringify(r.environment.productionAudit)
  if (!productionAuditMatchesRunner) invalidReasons.push('production_audit: the recomputed audit is not the one the runner attested')

  // The B2-C2B2E authority chain (B2-C2B1 / B2-C1 / B2-B1 / B2-C2B2B / B2-C2B2C / B2-C2B2D / oracle), re-read as B2-C2B2E's analyzer did.
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
  const parsedB2C2B2D = eTargets.parsePhase2C26B2C2B2EB2C2B2DAuthority(json(b2c2b2dFile), b2c2b2dFile.source.sha256, { b2c2b1ResultSha256: b2c2b1File.source.sha256,
    b2c1ResultSha256: b2c1File.source.sha256, b2b1ResultSha256: b2b1File.source.sha256, b2c2b2bResultSha256: b2c2b2bFile.source.sha256, b2c2b2cResultSha256: b2c2b2cFile.source.sha256, exportSha256 })
  if (!parsedB2C2B2D.valid) invalidReasons.push(...parsedB2C2B2D.issues.map(i => `b2c2b2d_authority: ${i}`))
  const authority = parsedB2C2B1.authority, b2c1Authority = parsedB2C1.authority, b2b1Authority = parsedB2B1.authority, oracle = oracleParse.oracle
  const b2c2b2bAuthority = parsedB2C2B2B.authority, b2c2b2cAuthority = parsedB2C2B2C.authority, b2c2b2dAuthority = parsedB2C2B2D.authority
  const probeManifest = probeManifestParse.manifest
  const eJson = json(b2c2b2eFile)
  const manifestRoutesSha256 = sha(JSON.stringify(manifest))
  const ready = authority && b2c1Authority && b2b1Authority && oracle && probeManifest && b2c2b2bAuthority && b2c2b2cAuthority && b2c2b2dAuthority && eParsed.valid && iParsed.valid && jParsed.valid
  const hashChain = !ready ? null : {
    b2c2b2eResultIsRegistered: b2c2b2eFile.source.sha256 === kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2E.resultSha256,
    b2c2b2iResultIsRegistered: b2c2b2iFile.source.sha256 === kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2I.resultSha256,
    b2c2b2jResultIsRegistered: b2c2b2jFile.source.sha256 === kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.resultSha256,
    b2c2b2iMadeAgainstB2C2B2E: iParsed.authority.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    b2c2b2jMadeAgainstB2C2B2E: jParsed.authority.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    b2c2b2jMadeAgainstB2C2B2I: jParsed.authority.b2c2b2iResultSha256 === b2c2b2iFile.source.sha256,
    b2c2b2eMadeAgainstB2C2B2D: eParsed.authority.b2c2b2dResultSha256 === b2c2b2dFile.source.sha256,
    b2c2b2eRecordsB2C2B2DSource: eJson.provenance?.b2c2b2dResultSha256 === b2c2b2dFile.source.sha256,
    b2c2b2eRecordsB2C2B2CSource: eJson.provenance?.b2c2b2cResultSha256 === b2c2b2cFile.source.sha256,
    b2c2b2eRecordsB2C2B2BSource: eJson.provenance?.b2c2b2bResultSha256 === b2c2b2bFile.source.sha256,
    b2c2b2eRecordsB2C2B1Source: eJson.provenance?.b2c2b1ResultSha256 === b2c2b1File.source.sha256,
    b2c2b2eRecordsB2C1Source: eJson.provenance?.b2c1ResultSha256 === b2c1File.source.sha256,
    b2c2b2eRecordsB2B1Source: eJson.provenance?.b2b1ResultSha256 === b2b1File.source.sha256,
    b2c2b2eRecordsOracleSource: eJson.provenance?.oracleResultSha256 === oracleFile.source.sha256,
    b2c2b2eRecordsOracleManifestSource: eJson.provenance?.oracleManifestFileSha256 === manifestFile.source.sha256,
    probeManifestFromB2C2B2E: probeManifest.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256,
    probeManifestFromB2C2B2I: probeManifest.b2c2b2iResultSha256 === b2c2b2iFile.source.sha256,
    probeManifestFromB2C2B2J: probeManifest.b2c2b2jResultSha256 === b2c2b2jFile.source.sha256,
    probeManifestMatchesRunner: probesFile.source.sha256 === r.environment.probeManifestSha256,
    authoritiesMatchRunner: r.environment.b2c2b2eResultSha256 === b2c2b2eFile.source.sha256 && r.environment.b2c2b2iResultSha256 === b2c2b2iFile.source.sha256
      && r.environment.b2c2b2jResultSha256 === b2c2b2jFile.source.sha256,
    b2c2b2eEvidenceMatchesRunner: kTargets.PHASE2C26B2C2B2K_B2C2B2E_EVIDENCE.every(name => r.environment.b2c2b2eEvidence?.[name]?.sha256 === evidence[name].localSha256),
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
    exportMatchesB2C2B2E: exportSha256 === eParsed.authority.exportSha256,
    exportMatchesB2C2B2I: exportSha256 === iParsed.authority.exportSha256,
    exportMatchesB2C2B2J: exportSha256 === jParsed.authority.exportSha256,
    exportMatchesB2C2B1: exportSha256 === authority.exportSha256,
    exportMatchesB2C1: exportSha256 === b2c1Authority.exportSha256,
    exportMatchesB2B1: exportSha256 === b2b1Authority.exportSha256,
    exportMatchesOracle: exportSha256 === oracle.exportSha256,
    b2c2b2bResultIsRegistered: b2c2b2bFile.source.sha256 === c2b2cTargets.PHASE2C26B2C2B2C_REGISTERED_B2C2B2B.resultSha256,
    b2c2b2cResultIsRegistered: b2c2b2cFile.source.sha256 === d2Targets.PHASE2C26B2C2B2D_REGISTERED_B2C2B2C.resultSha256,
    b2c2b2dResultIsRegistered: b2c2b2dFile.source.sha256 === eTargets.PHASE2C26B2C2B2E_REGISTERED_B2C2B2D.resultSha256,
    exportMatchesB2C2B2B: exportSha256 === b2c2b2bAuthority.exportSha256,
    exportMatchesB2C2B2C: exportSha256 === b2c2b2cAuthority.exportSha256,
    exportMatchesB2C2B2D: exportSha256 === b2c2b2dAuthority.exportSha256,
  }
  if (hashChain) for (const [name, ok] of Object.entries(hashChain)) if (ok === false) invalidReasons.push(`hash_chain: ${name}`)
  const manifestConsistency = oracle === null ? { valid: false, issues: ['no oracle'], checkedRoutes: 0 } : b2aAnalysis.validatePhase2C26B2AOracleManifest(manifest, oracle, manifestRoutesSha256 === oracle.manifestSha256)
  if (!manifestConsistency.valid) invalidReasons.push(...manifestConsistency.issues.map(i => `oracle_manifest: ${i}`))
  if (!ready) {
    const decision = analysis.phase2c26b2c2b2kDecision({ invalidReasons, tasks: 0, targets: 0, measuredTasks: 0, exactTargets: { C8: 0, C32: 0, C4C: 0 } })
    await writeFile(paths.output, JSON.stringify({ phase: 'Issue #154 Phase 2-C2.6-B2-C2B2K (post-hoc analysis)', analyzedAt: new Date().toISOString(), invalidReasons, decision }, null, 2) + '\n', { flag: 'wx' })
    throw new Error(`B2C2B2K_INVALID: ${decision.reasons.join('; ')}`)
  }

  // The population and the probe: the manifest must be exactly the re-derived population (B2-C2B2F's rule over the B2-C2B2E RESULT,
  // cross-checked with B2-C2B2I / B2-C2B2J), and its probe must be B2-C2B2E's own probe derivation, which is re-derived again through
  // B2-C2B2E's authority chain (phase2c26b2c2b2eProbes()) and must equal what the B2-C2B2E RESULT recorded.
  const population = kTargets.phase2c26b2c2b2kPopulation(eParsed, iParsed.authority, jParsed.authority)
  invalidReasons.push(...population.issues.map(i => `population: ${i}`))
  const expectedManifest = population.valid ? kTargets.phase2c26b2c2b2kProbeManifest(eParsed, iParsed.authority, jParsed.authority) : null
  const eDerived = eTargets.phase2c26b2c2b2eProbes(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority, b2c2b2dAuthority)
  invalidReasons.push(...eDerived.issues.map(i => `b2c2b2e_probes: ${i}`))
  const targetWeaponIds = probeManifest.probes.map(p => p.targetWeaponId)
  const derivations = eDerived.derivations.filter(d => targetWeaponIds.includes(d.targetWeaponId))
  const eRecordedProbe = (eJson.probes ?? []).filter(p => targetWeaponIds.includes(p.targetWeaponId))
  const e1Population = d2Targets.phase2c26b2c2b2dPopulation(authority, b2c1Authority, b2c2b1Json, b2c2b2bAuthority, b2c2b2cAuthority)
  invalidReasons.push(...e1Population.issues.map(i => `e1_population: ${i}`))
  const split = e1Population.split
  const populationParity = { manifestEqualsDerived: expectedManifest !== null && JSON.stringify(expectedManifest) === JSON.stringify(probeManifest),
    runnerTargetsEqualManifest: JSON.stringify(r.targetWeaponIds) === JSON.stringify(targetWeaponIds), runnerProbesEqualManifest: JSON.stringify(r.environment.probes) === JSON.stringify(probeManifest.probes),
    runnerIdentitiesEqualManifest: JSON.stringify(r.environment.expectedTaskIdentities) === JSON.stringify(probeManifest.expectedTaskIdentities),
    targets: targetWeaponIds.length, populationIsB2C2B2ETimeBoundTimeout: JSON.stringify(targetWeaponIds) === JSON.stringify(population.targetWeaponIds),
    reDerivedB2C2B2EProbesEqualB2C2B2EResult: JSON.stringify(eDerived.derivations) === JSON.stringify(eJson.probes),
    derivationIsB2C2B2ERecordedProbe: derivations.length === 1 && JSON.stringify(derivations) === JSON.stringify(eRecordedProbe),
    probeIsDerivation: derivations.length === 1 && probeManifest.probes[0].b2c2b2dTaskId === derivations[0].b2c2b2dTaskId && probeManifest.probes[0].contextRank === derivations[0].b2c1FirstCompatibleRank
      && JSON.stringify(probeManifest.probes[0].extent) === JSON.stringify(derivations[0].tightExtent),
    populationInsideE1L2: targetWeaponIds.every(id => split.l2.includes(id)), chain: population.chain,
    others: eParsed.population?.others ?? [] }
  for (const [name, ok] of Object.entries(populationParity)) if (ok === false) invalidReasons.push(`population: ${name}`)

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
  const rebuilt = k.buildPhase2C26B2C2B2KTasks(schedule, probeManifest)
  if (!rebuilt.valid) invalidReasons.push(...rebuilt.issues.map(i => `tasks: ${i}`))
  const summary = r.tasksChild.scheduleSummary
  const eRow = facts.taskRow
  const scheduleParity = {
    tasksMatchReDerivedSchedule: JSON.stringify(rebuilt.tasks) === JSON.stringify(r.tasks),
    contextsDigestMatches: summary.contextsDigest === sha(hashing.stableStringify(schedule.contexts)),
    originDigestMatches: summary.originDigest === schedule.snapshot.originDigest,
    scheduleExtentIsDefault: JSON.stringify(summary.extent) === JSON.stringify(schedule.extent) && JSON.stringify(schedule.extent) === JSON.stringify(e1Targets.PHASE2C26B2C2B2A_REGISTERED_B2C2B1.rungs[0].extent),
    policiesMatch: JSON.stringify(summary.policies) === JSON.stringify(schedule.policies),
    originsMatchB2C2B2E: JSON.stringify(schedule.origins) === JSON.stringify(facts.origins),
    taskIsB2C2B2ETaskIdentity: r.tasks.length === 1 && JSON.stringify(Object.fromEntries(Object.keys(probeManifest.expectedTaskIdentities[0]).map(f => [f, r.tasks[0][f]])))
      === JSON.stringify(Object.fromEntries(Object.keys(probeManifest.expectedTaskIdentities[0]).map(f => [f, eRow[f]]))),
    everyTaskInsideBounds: r.tasks.every(t => k.phase2c26b2c2b2kExtentBoundIssues(t.extent).length === 0),
    calculationContextMatchesB2C2B2E: r.stage1.every(run => (run.outcome.process !== 'completed' && run.calculationContext === null) || JSON.stringify(run.calculationContext) === JSON.stringify(input.calculationContext))
      && JSON.stringify(r.tasksChild.calculationContext) === JSON.stringify(input.calculationContext) && JSON.stringify(input.calculationContext) === JSON.stringify(facts.calculationContext),
    researchMaxPlanStepsMatchesB2C2B2E: input.options.maxPlanSteps === facts.researchMaxPlanSteps,
    engineMatchesB2C2B2E: r.stage1.every(run => (run.outcome.process !== 'completed' && run.rngEngineVersion === null) || run.rngEngineVersion === engine.version)
      && r.environment.rngEngineVersion === engine.version && engine.version === facts.rngEngineVersion,
    everyTaskRan: r.stage1.length === r.tasks.length,
    taskCount: r.tasks.length,
  }
  for (const [name, ok] of Object.entries(scheduleParity)) if (ok === false) invalidReasons.push(`schedule_parity: ${name}`)
  // Execution conditions: Stage 1 is B2-C2B2E's in every field, and nothing instruments the child.
  const stage1 = r.environment.stage1
  const searchProcesses = (r.processes ?? []).filter(p => p.role === 'search')
  const conditionChecks = { stage1IsRegistered: JSON.stringify(stage1) === JSON.stringify(k.PHASE2C26B2C2B2K_STAGE1),
    stage1EqualsB2C2B2EResultStage1: JSON.stringify(stage1) === JSON.stringify(eParsed.authority.stage1),
    noStage1FieldChanged: Object.keys(stage1).filter(key => JSON.stringify(stage1[key]) !== JSON.stringify(eParsed.authority.stage1[key])).length === 0
      && Object.keys(eParsed.authority.stage1).length === Object.keys(stage1).length,
    budgetIs60Minutes: stage1.budgetMs === 3_600_000 && stage1.budgetMs === facts.b2c2b2e.budgetMs, heapIs12288Mb: stage1.childHeapMb === 12_288 && stage1.childHeapMb === facts.b2c2b2e.childHeapMb,
    concurrencyIs1: stage1.concurrency === 1, noRetry: stage1.retry === 'none', noFallback: stage1.fallback === 'none', freshChild: searchProcesses.length === r.stage1.length,
    oneSearchChildPerTask: new Set(searchProcesses.map(p => p.id)).size === searchProcesses.length,
    everyChildAtTheBudget: r.stage1.every(run => run.process.budgetMs === stage1.budgetMs),
    everyChildAtTheHeapFlagOnly: searchProcesses.every(p => JSON.stringify(p.nodeFlags) === JSON.stringify([`--max-old-space-size=${stage1.childHeapMb}`])),
    noInstrumentation: JSON.stringify(r.environment.instrumentation) === JSON.stringify(k.PHASE2C26B2C2B2K_INSTRUMENTATION)
      && Object.values(k.PHASE2C26B2C2B2K_INSTRUMENTATION).every(v => v === false || v === 'none'),
    captureUnchanged: r.environment.maxCostCohorts === c2b2d.PHASE2C26B2C2B2D_MAX_COST_COHORTS && r.environment.candidateSafetyCap === c2b2d.PHASE2C26B2C2B2D_CANDIDATE_SAFETY_CAP
      && JSON.stringify(r.environment.capturePrefixes) === JSON.stringify(c2b2d.PHASE2C26B2C2B2D_CAPTURE_PREFIXES),
    yieldAndSamplingUnchanged: r.environment.nodeYield === c2b2d.PHASE2C26B2C2B2D_NODE_YIELD && r.environment.memorySampleIntervalMs === c2b2d.PHASE2C26B2C2B2D_MEMORY_SAMPLE_INTERVAL_MS,
    expectedTasks: r.environment.expectedTasks === k.PHASE2C26B2C2B2K_EXPECTED_TASKS,
    contextSelectionAndExtentRuleUnchanged: r.environment.contextSelection === c2b2d.PHASE2C26B2C2B2D_CONTEXT_SELECTION.id && r.environment.extentRule === c2b2d.PHASE2C26B2C2B2D_EXTENT_RULE.id,
    childCalculationIsB2C2B2E: k.runPhase2C26B2C2B2KTask === c2b2e.runPhase2C26B2C2B2ETask && c2b2e.runPhase2C26B2C2B2ETask === c2b2d.runPhase2C26B2C2B2DTask }
  if (!smoke) for (const [name, ok] of Object.entries(conditionChecks)) if (ok === false) invalidReasons.push(`conditions: ${name}`)
  for (const [flag, value] of Object.entries(k.PHASE2C26B2C2B2K_PROVENANCE_FLAGS)) if (r.environment[flag] !== value) invalidReasons.push(`provenance: ${flag} is not ${String(value)}`)
  // Search child isolation: the child got a task file only, and the task holds the registered task shape and no oracle-derived expectation.
  const taskKeys = Object.keys(r.tasks[0] ?? {}).sort()
  const childIsolation = { taskKeysAreB2C2B2ETaskKeys: JSON.stringify(taskKeys) === JSON.stringify(Object.keys(rebuilt.tasks[0] ?? {}).sort()),
    noExpectationInTask: !/stableKey|expectedCandidate|expectedOperation|expectedRoute|oracle|recovered|time_bound|speedup|b2c2b2[eij]Result/i.test(JSON.stringify(r.tasks)),
    childArgumentsAreTaskOnly: true }
  for (const [name, ok] of Object.entries(childIsolation)) if (ok === false) invalidReasons.push(`isolation: ${name}`)

  // Child records, each checked against the SHA-256 the runner recorded; the memory logs as the runner appended them.
  const recordIssues = []
  const runs = []
  const memorySamples = new Map()
  const childWallMs = new Map()
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
    childWallMs.set(run.taskId, run.childWallMs ?? null)
    const memoryPath = join(paths.runDir, `stage1-${run.taskId}.memory.jsonl`)
    memorySamples.set(run.taskId, existsSync(memoryPath) ? lines((await readFile(memoryPath)).toString('utf8')).map(line => JSON.parse(line)) : [])
  }
  invalidReasons.push(...recordIssues.map(i => `raw_result: ${i}`))

  // Post-hoc compatibility (must reproduce B2-C1), the oracle comparison and the paired comparisons with B2-C2B2D and B2-C2B2E.
  const reach = await c2aAnalysis.phase2c26b2c2aReach(schedule, targetWeaponIds, manifest, oracle)
  const searchOf = run => run?.record?.status === 'searched' ? run.record.search : null
  const excludedRouteKeySha256 = new Map(runs.map(run => [run.taskId, searchOf(run) ? sha(searchOf(run).excludedRouteKeys[0]) : null]))
  const b2dRowOf = id => b2c2b2dAuthority.taskRows.find(row => row.targetWeaponId === id)
  const rederivations = new Map(r.tasks.flatMap(task => {
    const row = b2dRowOf(task.targetWeaponId)
    return row === undefined ? [] : [[task.taskId, d2Analysis.phase2c26b2c2b2dRederiveBaselineContext(schedule, row, sha)]]
  }))
  const b2c2b2eRederivations = new Map(r.tasks.map(task => [task.taskId, d2Analysis.phase2c26b2c2b2dRederiveBaselineContext(schedule, eRow, sha)]))
  const audit = analysis.runPhase2C26B2C2B2KAnalysis({ derivations, tasks: r.tasks, runs, reach, excludedRouteKeySha256, rederivations, memorySamples, b2c2b2d: b2c2b2dAuthority,
    oracle: { routes: oracle.routes, gogmaUsage: oracle.gogmaUsage }, smoke, conditions: { budgetMs: stage1.budgetMs, childHeapMb: stage1.childHeapMb }, facts, b2c2b2eRederivations, childWallMs })
  invalidReasons.push(...audit.invalidReasons)

  const runOf = new Map(runs.map(run => [run.taskId, run]))
  const taskRows = audit.contexts.map(c => {
    const run = runOf.get(c.taskId), s = searchOf(run)
    const task = r.tasks.find(t => t.taskId === c.taskId)
    const peak = run ? analysis.phase2c26b2c2b2kPeak(run) : null
    return { taskId: c.taskId, targetWeaponId: c.targetWeaponId, contextRank: c.contextRank, groupIndex: c.groupIndex, reservationDigest: task.reservationDigest,
      targetEligibleMinCardinality: task.targetEligibleMinCardinality, representativeFixedSetId: task.representativeFixedSetId, representativeFixedTargetWeaponIds: task.representativeFixedTargetWeaponIds,
      defaultSearchInputDigest: task.defaultSearchInputDigest, searchInputDigest: task.searchInputDigest, extent: task.extent, excludedRouteKeySha256: excludedRouteKeySha256.get(c.taskId) ?? null,
      process: run?.outcome.record === 'context_mismatch' ? 'context_mismatch' : run?.process.outcome ?? 'not_run', record: run?.outcome.record ?? null, budgetMs: run?.process.budgetMs ?? null,
      wallMs: run?.process.wallMs ?? null, childWallMs: run?.childWallMs ?? null, searchElapsedMs: s?.elapsedMs ?? null, scheduleMs: run?.scheduleMs ?? null, peakHeapBytes: peak?.heap ?? null,
      peakRssBytes: peak?.rss ?? null, yields: run?.yields ?? null, status: s?.status ?? null, termination: s?.termination ?? null, candidateCount: c.candidateCount,
      deliveredCandidates: s?.summary.deliveredCandidates ?? null, excludedCandidates: s?.summary.excludedCandidates ?? null, distinctCostCohorts: s?.distinctCostCohorts ?? null,
      capturedCosts: c.capturedCosts, captureComplete: c.captureComplete, safetyCapHit: c.safetyCapHit,
      nextCostSentinel: s?.nextCostSentinel ? { deliveryIndex: s.nextCostSentinel.deliveryIndex, estimatedOperationCount: s.nextCostSentinel.orderingKeys.estimatedOperationCount } : null,
      compatible: c.compatible, coverage: c.coverage, firstExactIndex: c.firstExactIndex, firstExactCost: c.firstExactCost, firstPartialIndex: c.firstPartialIndex, exactCount: c.exactIndexes.length,
      partialCount: c.partialIndexes.length, hit: c.hit, sentinelExact: c.sentinelExact, sentinelPartial: c.sentinelPartial, reservationViolations: c.reservationViolations,
      firstExactCandidate: c.firstExactIndex === null ? null : compactCandidate(s.candidates[c.firstExactIndex]) }
  })

  const b2c2b1Routes = new Map((b2c2b1Json.routes ?? []).map(route => [route.targetWeaponId, route]))
  const targets = audit.rows.map((row, index) => {
    const route = b2c2b1Routes.get(row.targetWeaponId)
    const derivation = derivations.find(d => d.targetWeaponId === row.targetWeaponId)
    const pairedE = audit.paired.find(p => p.targetWeaponId === row.targetWeaponId)
    return { targetIndex: index, ...row, type: facts.type,
      b2c2b1: route === undefined ? null : { required: route.required, insufficientStreams: route.insufficientStreams, firstLadderRung: route.firstLadderRung, p1FirstCompatibleRank: route.p1FirstCompatibleRank,
        routeKind: route.route?.routeKind ?? null, sourceKind: route.route?.sourceKind ?? null, conversion: route.route?.conversion ?? null, routeOperationCount: route.route?.operations ?? null },
      extents: derivation === undefined ? null : { required: derivation.required, tight: derivation.tightExtent, commonL2: derivation.commonL2Extent },
      recovery: audit.recoveries.find(x => x.taskId === row.taskId)?.recovery ?? null,
      pairedB2C2B2E: pairedE ?? null,
      pairedB2C2B2DIdentity: audit.paired ? (audit.contexts.length > 0 ? 'checked by B2-C2B2E\'s analysis (invalid reasons prefixed paired_b2c2b2d)' : null) : null,
      trajectory: audit.trajectories.find(t => t.taskId === row.taskId)?.trajectory ?? null,
      b2c2b2eTrajectory: facts.trajectory }
  })
  const preliminary = analysis.phase2c26b2c2b2kDecision({ invalidReasons, ...audit.decisionInput })
  const finalDecision = !formal && !allowNonformal ? null : preliminary
  const e1Aggregate = analysis.phase2c26b2c2b2kE1Aggregate({ facts, row: audit.rows[0], decision: finalDecision?.case ?? null, evidenceGrade })
  invalidReasons.push(...e1Aggregate.issues.map(i => `e1_aggregate: ${i}`))
  const decision = finalDecision === null ? null : analysis.phase2c26b2c2b2kDecision({ invalidReasons, ...audit.decisionInput })
  if (decision !== null && decision.case !== finalDecision.case) throw new Error('The E1 aggregate changed the decision: the aggregate is never a decision input.')
  const recovery = audit.recoveries[0]?.recovery ?? null
  const record = {
    phase: 'Issue #154 Phase 2-C2.6-B2-C2B2K: the B2-C2B2E time-bound Target, same Search input and execution conditions (60 minutes / 12 GB) on the optimized current main (oracle-guided diagnostic, post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: runFile.source, startAttestation: attestationFile?.source ?? null, probeManifest: probesFile.source, export: exportFile.source, b2c2b1Result: b2c2b1File.source,
      b2c1Result: b2c1File.source, b2b1Result: b2b1File.source, b2c2b2bResult: b2c2b2bFile.source, b2c2b2cResult: b2c2b2cFile.source, b2c2b2dResult: b2c2b2dFile.source,
      b2c2b2eResult: b2c2b2eFile.source, b2c2b2iResult: b2c2b2iFile.source, b2c2b2jResult: b2c2b2jFile.source, b2c2b2eEvidence: evidence, oracle: oracleFile.source, oracleManifest: manifestFile.source },
    provenance: { formal, evidenceGrade, partialRun: false,
      launchProvenanceVerified: launchProvenance.verified, launchProvenanceSource: launchProvenance.source, launchProvenanceReason: launchProvenance.reason,
      launchProvenanceIssues: launchProvenance.issues, launchProvenanceIntegrityIssues: launchProvenance.integrityIssues, launchWorkingTreeCleanVerified: launchProvenance.workingTreeCleanVerified,
      startAttestation: attestationFile === null ? null : { file: attestationFile.source.file, sha256: attestationFile.source.sha256, bytes: attestationFile.source.bytes, body: json(attestationFile) },
      recordedStartAttestation: r.launchAttestation ?? null,
      measuredHead, measuredHeadSource: launchProvenance.verified ? 'runner_start_attestation' : 'runner', measuredHeadIsAncestor,
      recomputedBenchmarkCodeSha256, benchmarkCodeSha256: r.environment.benchmarkCodeSha256,
      analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted: analysisUncommitted, codeChangedSinceMeasuredHead: changedSinceMeasured,
      calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: [...analysisPaths, '*.test.ts'],
      uncommittedBenchmarkCode: launchProvenance.verified ? false : r.environment.uncommittedBenchmarkCode ?? null, smoke: r.environment.smoke,
      exportFileName: r.environment.exportFileName, exportSha256, exportBytes: exportFile.source.bytes,
      b2c2b2eResultSha256: b2c2b2eFile.source.sha256, b2c2b2eMeasuredHead: eParsed.authority.measuredHead, b2c2b2eDecisionCase: eParsed.authority.decisionCase,
      b2c2b2iResultSha256: b2c2b2iFile.source.sha256, b2c2b2iMeasuredHead: iParsed.authority.measuredHead, b2c2b2iDecisionCase: iParsed.authority.decisionCase,
      b2c2b2jResultSha256: b2c2b2jFile.source.sha256, b2c2b2jMeasuredHead: jParsed.authority.measuredHead, b2c2b2jDecisionCase: jParsed.authority.decisionCase,
      b2c2b2dResultSha256: b2c2b2dFile.source.sha256, b2c2b2cResultSha256: b2c2b2cFile.source.sha256, b2c2b2bResultSha256: b2c2b2bFile.source.sha256,
      b2c2b1ResultSha256: b2c2b1File.source.sha256, b2c1ResultSha256: b2c1File.source.sha256, b2b1ResultSha256: b2b1File.source.sha256,
      oracleResultSha256: oracleFile.source.sha256, oracleManifestFileSha256: manifestFile.source.sha256, oracleManifestRoutesSha256: manifestRoutesSha256, probeManifestSha256: probesFile.source.sha256,
      baseMain: k.PHASE2C26B2C2B2K_BASE_MAIN, productionChangedFilesInThisPhase: productionAudit?.productionChangedSinceBaseMain ?? null, adoptedOptimizations,
      ...k.PHASE2C26B2C2B2K_PROVENANCE_FLAGS,
      measuredAt: r.measuredAt, runWallMs: r.wallMs, machineAtLaunch: r.environment.machine ?? null },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch, osRelease: r.environment.osRelease,
      cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes, rngEngineVersion: r.environment.rngEngineVersion },
    productionAudit: { ...productionAudit, issues: auditIssues, matchesRunnerAttested: productionAuditMatchesRunner },
    conditions: { stage1, b2c2b2eStage1: eParsed.authority.stage1, changedStage1Fields: [...k.PHASE2C26B2C2B2K_CHANGED_STAGE1_FIELDS], conditionChecks, tasksBudgetMs: r.environment.tasksBudgetMs,
      targets: r.environment.targets, contextsPerTarget: r.environment.contextsPerTarget, expectedTasks: r.environment.expectedTasks, maxCostCohorts: r.environment.maxCostCohorts,
      candidateSafetyCap: r.environment.candidateSafetyCap, capturePrefixes: r.environment.capturePrefixes, capturePolicies: analysis.PHASE2C26B2C2B2K_CAPTURE_POLICIES, population: r.environment.population,
      contextSelection: k.PHASE2C26B2C2B2K_CONTEXT_SELECTION, extentRule: k.PHASE2C26B2C2B2K_EXTENT_RULE, extentFloor: r.environment.extentFloor, extentCeiling: r.environment.extentCeiling,
      probes: r.environment.probes, expectedTaskIdentities: r.environment.expectedTaskIdentities, scheduleExtent: schedule.extent, nodeYield: r.environment.nodeYield,
      memorySampleIntervalMs: r.environment.memorySampleIntervalMs, instrumentation: r.environment.instrumentation, registeredP1: r.environment.registeredP1, origins: schedule.origins,
      calculationContext: input.calculationContext, researchMaxPlanSteps: input.options.maxPlanSteps, notRun: r.environment.notRun,
      changedFromB2C2B2E: ['the Production calculation source: the current main holds the adopted B2-C2B2I (predict_keep_nested_counter_family_cache_v1) and B2-C2B2J (reserved_keep_family_layout_key_reuse_v1) optimizations; this phase changes none',
        'population: the 2 B2-C2B2E Targets -> the 1 B2-C2B2E time-bound Target that timed out (the recovered one is not re-run)'],
      unchangedFromB2C2B2E: ['the Target / B2-C1 P1 first compatible context / target-relative tight extent / group / reservation / representative / default and tight Search input digests / excluded current Route',
        'Planner-start origin and reservation universe', 'P1 ordering', 'the B2-C2B2E task construction and child calculation (the same function objects) and the B2-C2B2A Search body',
        'Search comparator and Candidate materializer', 'C4C capture, max 4 distinct cost cohorts, 5th-cost sentinel, safety cap 1024', 'Stage 1: 60 minutes, 12,288 MB, concurrency 1, fresh child, no retry, no fallback',
        'setImmediate yield', '250 ms memory sampling', 'no instrumentation (no section observer, no CPU profiler, no allocation profiler, no heap snapshot)', 'oracle isolation',
        'no exact early stop, no context early stop', 'runner start attestation contract'],
      searchChildKnows: ['targetWeaponId', 'P1 context rank (the oracle-guided first compatible rank, given as a number)', 'reservation digest / group / representative alias (re-derived and checked)',
        'Planner-start origin (re-derived)', 'reservation (re-derived)', 'excluded current Route key (re-derived)', 'default / tight Search input digests', 'the tight extent (oracle-informed, given as numbers)',
        'capture rule (4 cost cohorts)', 'safety cap 1024'],
      searchChildNeverKnows: ['oracle RESULT', 'oracle manifest', 'every earlier RESULT', 'B2-C2B2E outcome and measurements', 'that the Target was time_bound', 'B2-C2B2I / B2-C2B2J speed-ups',
        'that the rank is the first compatible one', 'the required extent itself', 'expected exact stable key', 'expected Candidate index', 'expected operation cost', 'expected route kind',
        'oracle Route body', 'expected recovery result'],
      childIsolation,
      limitation: 'An oracle-guided diagnostic: the population, the context and the extent all come from post-hoc oracle evidence, and the execution budget is B2-C2B2E\'s 60 minutes / 12 GB. It measures only whether, given the same known compatible context and tight extent, the current main\'s optimized existing Search delivers the exact oracle Route within 60 minutes and a 12 GB heap. It is not evidence that Production could pick the context, know the extent or afford the budget, and not evidence for a Production scheduler or runtime.' },
    parity: { b2c2b2eAuthority: { valid: eParsed.valid, decisionCase: eParsed.authority.decisionCase }, b2c2b2iAuthority: { valid: iParsed.valid, decisionCase: iParsed.authority.decisionCase },
      b2c2b2jAuthority: { valid: jParsed.valid, decisionCase: jParsed.authority.decisionCase }, b2c2b1Authority: { valid: parsedB2C2B1.valid }, b2c1Authority: { valid: parsedB2C1.valid },
      b2b1Authority: { valid: parsedB2B1.valid }, oracle: { valid: oracleParse.valid }, b2c2b2bAuthority: { valid: parsedB2C2B2B.valid }, b2c2b2cAuthority: { valid: parsedB2C2B2C.valid },
      b2c2b2dAuthority: { valid: parsedB2C2B2D.valid }, hashChain, b2c2b2eEvidence: evidence, manifestConsistency: { valid: manifestConsistency.valid, checkedRoutes: manifestConsistency.checkedRoutes },
      population: { ...populationParity, issues: population.issues }, scheduleConsistency: { valid: scheduleConsistency.valid, issues: scheduleConsistency.issues }, b2b1Parity, policyDrift,
      taskConstruction: { valid: rebuilt.valid, issues: rebuilt.issues }, scheduleParity, recordIssues,
      pairedIdentityB2C2B2E: audit.paired.map(p => ({ taskId: p.taskId, ...p.identity })),
      rederivations: { b2c2b2d: [...rederivations.values()], b2c2b2e: [...b2c2b2eRederivations.values()] } },
    probes: derivations,
    tasks: { total: r.tasks.length, targets: targetWeaponIds.length, contextsPerTarget: k.PHASE2C26B2C2B2K_CONTEXTS_PER_TARGET },
    aggregates: audit.aggregates,
    recovery,
    pairedComparison: audit.paired,
    trajectories: audit.trajectories,
    background: { b2c2b2jDirect: jParsed.authority.direct, note: 'B2-C2B2J\'s same-work state_generation ratio (background only). This phase does not decompose the B2-C2B2I / B2-C2B2J effects from its single run.' },
    e1Aggregate,
    targets,
    taskRows,
    decisionRule: analysis.PHASE2C26B2C2B2K_DECISION_RULE,
    invalidReasons,
    decision,
  }
  record.provenance.machineDuringRun = monitorPath === undefined ? null : (() => {
    const raw = readFileSync(monitorPath)
    const samples = lines(raw.toString('utf8')).map(line => /^(\S+) freeGB=(\S+) cpu=(\S+) encoders=(\d+)/.exec(line)).filter(Boolean)
      .map(m => ({ at: m[1], freeGB: Number(m[2]), cpu: Number(m[3]), encoders: Number(m[4]) }))
    const busy = samples.filter(s => s.encoders > 0)
    return { file: basename(monitorPath), sha256: sha(raw), intervalSeconds: 60, samples: samples.length, firstAt: samples[0]?.at ?? null, lastAt: samples.at(-1)?.at ?? null,
      encoderSamples: busy.length, encoderFirstAt: busy[0]?.at ?? null, encoderLastAt: busy.at(-1)?.at ?? null,
      maxCpuPercent: samples.length === 0 ? null : Math.max(...samples.map(s => s.cpu)),
      maxCpuPercentWithoutEncoder: samples.filter(s => s.encoders === 0).reduce((max, s) => Math.max(max, s.cpu), 0),
      minFreeGB: samples.length === 0 ? null : Math.min(...samples.map(s => s.freeGB)),
      note: 'Observation only (sampled once a minute by the operator, outside the runner). An external encoder load during the run can only slow the single-threaded Search; it changes no Search input, ordering or result. Never a decision input; the run was not repeated.' }
  })()
  await writeFile(paths.output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: resolve(paths.output), formal, evidenceGrade, launchProvenance: { verified: launchProvenance.verified, issues: launchProvenance.issues },
    hashChainAllTrue: hashChain !== null && Object.values(hashChain).every(v => v === true), population: populationParity, scheduleParity, conditionChecks, childIsolation,
    productionAudit: { sinceB2C2B2E: productionAudit?.productionChangedSinceB2C2B2E, sinceBaseMain: productionAudit?.productionChangedSinceBaseMain, issues: auditIssues, matchesRunner: productionAuditMatchesRunner },
    evidence, recordIssues: recordIssues.length, exactTargets: audit.aggregates.exactTargets, execution: audit.aggregates.execution, recovery,
    paired: audit.paired.map(p => ({ identity: p.identity.matches, route: p.identity.excludedRouteKeyComparison, transition: p.outcomeTransition, delta: p.delta, ratio: p.ratio })),
    e1Aggregate: { commonLadder: e1Aggregate.commonLadder.total, diagnostic: e1Aggregate.diagnostic.total, statement: e1Aggregate.diagnostic.statement, issues: e1Aggregate.issues },
    invalidReasons: invalidReasons.slice(0, 30), invalidReasonCount: invalidReasons.length, decision }, null, 2))
} finally {
  await server.close()
}
