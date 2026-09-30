// Issue #154 Phase 2-C2.6-A8: post-hoc analysis of one raw run of run-planner-global-phase2c26a8.mjs.
// Reads the raw run, its CPU profiles / script tables (--profiles-dir), the committed Phase 2-C2.6-A .. A7 RESULTs (A7 =
// selection / hotspot authority) and the A7 formal raw run (accepted only when its SHA-256 is the one the A7 RESULT
// recorded), and writes the committed evidence JSON. Runs no Planner and no Search. Before any analysis,
// validatePhase2C26A8FormalRun() (src/benchmarks/plannerGlobalPhase2C26A8Analysis.ts) must prove the run is the formal A8
// series (the A7 instrumentation and conditions plus the registered profiler, the SHA chain, a successful probe, the
// analyzer's own re-derivation of baseline / condition / selection parity and of the diagnostic representative, no
// Production change since the A7 measured HEAD, complete captures, and the completed-work and held-aware depth records
// equal to A7's on their common prefix); each profile / script table must match the SHA-256 its child recorded. The
// function spans and the frontier block are read from the measured HEAD's source text. Otherwise no RESULT is written.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import sourceMap from 'source-map-js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), profilesDir = option('--profiles-dir'), outputPath = option('--output'), a7RawPath = option('--a7-raw')
const c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), a3Path = option('--c26a3-result'), a4Path = option('--c26a4-result')
const a5Path = option('--c26a5-result'), a6Path = option('--c26a6-result'), a7Path = option('--c26a7-result')
if (!runPath || !profilesDir || !outputPath || !a7RawPath || !c26aPath || !a2Path || !a3Path || !a4Path || !a5Path || !a6Path || !a7Path) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a8.mjs --run <raw.json.local> --profiles-dir <dir .local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --c26a4-result docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json --c26a5-result docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json --c26a6-result docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json --c26a7-result docs/PLANNER_GLOBAL_PHASE2C26A7_RESULT.json --a7-raw PLANNER_GLOBAL_PHASE2C26A7_RAW.json.local --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c26aFile = await load(c26aPath), a2File = await load(a2Path), a3File = await load(a3Path), a4File = await load(a4Path)
const a5File = await load(a5Path), a6File = await load(a6Path), a7File = await load(a7Path), a7Raw = await load(a7RawPath)
const r = run.json

// The calculation / measurement code (Production, the Research modules, the runner and everything they load) must be the
// measured HEAD; only the post-hoc files below may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a8.mjs', 'src/benchmarks/plannerGlobalPhase2C26A8Analysis.ts', '*.test.ts']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation / measurement code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const analysisCodeChangedSinceMeasuredHead = changed.filter(postHocOnly)
const analysisCodeUncommitted = Boolean(git('status', '--porcelain', '--', 'src', 'scripts'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const a2m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts')
  const a3m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A3.ts')
  const a4m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A4.ts')
  const a5m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5.ts')
  const a5Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts')
  const a6m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A6.ts')
  const a6Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A6Analysis.ts')
  const a7m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A7.ts')
  const a8m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A8.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A8Analysis.ts')
  const shas = { c26a: c26aFile.source.sha256, a2: a2File.source.sha256, a3: a3File.source.sha256, a4: a4File.source.sha256, a5: a5File.source.sha256,
    a6: a6File.source.sha256, a7: a7File.source.sha256 }
  const parsedC26a = a2m.parsePhase2C26AAuthority(c26aFile.json)
  if (!parsedC26a.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedC26a.issues.join('; ')}`)
  const c26a = parsedC26a.authority
  const parsedA2 = a3m.parsePhase2C26A2ResultAuthority(a2File.json, shas.c26a, c26a)
  if (!parsedA2.valid) throw new Error(`The Phase 2-C2.6-A2 RESULT is not the registered authority: ${parsedA2.issues.join('; ')}`)
  const a2 = parsedA2.authority
  const parsedA3 = a4m.parsePhase2C26A3ResultAuthority(a3File.json, shas.c26a, shas.a2, a2, c26a)
  if (!parsedA3.valid) throw new Error(`The Phase 2-C2.6-A3 RESULT is not the registered authority: ${parsedA3.issues.join('; ')}`)
  const a3 = parsedA3.authority
  const parsedA4 = a5m.parsePhase2C26A4ResultAuthority(a4File.json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3 }, a3, c26a)
  if (!parsedA4.valid) throw new Error(`The Phase 2-C2.6-A4 RESULT is not the registered authority: ${parsedA4.issues.join('; ')}`)
  const a4 = parsedA4.authority
  const parsedA5 = a6m.parsePhase2C26A5ResultAuthority(a5File.json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4 }, a4, c26a)
  if (!parsedA5.valid) throw new Error(`The Phase 2-C2.6-A5 RESULT is not the registered authority: ${parsedA5.issues.join('; ')}`)
  const a5 = parsedA5.authority
  const parsedA6 = a7m.parsePhase2C26A6ResultAuthority(a6File.json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4, a5: shas.a5 }, a5, c26a)
  if (!parsedA6.valid) throw new Error(`The Phase 2-C2.6-A6 RESULT is not the registered authority: ${parsedA6.issues.join('; ')}`)
  const a6 = parsedA6.authority
  const parsedA7 = a8m.parsePhase2C26A7ResultAuthority(a7File.json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4, a5: shas.a5, a6: shas.a6 }, a6, c26a)
  if (!parsedA7.valid) throw new Error(`The Phase 2-C2.6-A7 RESULT is not the registered authority: ${parsedA7.issues.join('; ')}`)
  const a7 = parsedA7.authority

  // Re-derived from git (committed history, not the runner's record): the Production change between the A7 measured HEAD
  // and this measured HEAD.
  const productionChangeSinceA7 = git('diff', '--name-only', a7.measuredHead, measuredHead, '--', 'src').split(/\r?\n/).filter(Boolean)
  // The A7 formal raw run: only the file the A7 RESULT recorded.
  const a7RawShaMatches = a7.runSha256 === a7Raw.source.sha256
  const a7Kernel = id => (a7Raw.json.kernels ?? []).find(kernel => kernel.orientationId === id) ?? null
  const a8Kernel = id => (r.kernels ?? []).find(kernel => kernel.orientationId === id) ?? null
  const workPrefix = a7.primaryOrientationIds.map(orientationId => ({ orientationId, prefix: a6Analysis.comparePhase2C26A6WorkPrefix(a7Kernel(orientationId), a8Kernel(orientationId)) }))
  const depthPrefix = a7.primaryOrientationIds.map(orientationId => ({ orientationId, prefix: analysis.comparePhase2C26A8DepthPrefix(a7Kernel(orientationId), a8Kernel(orientationId)) }))
  const formalRunValidation = analysis.validatePhase2C26A8FormalRun(r, { c26a, a2, a3, a4, a5, a6, a7 }, shas, { productionChangeSinceA7, a7RawShaMatches, workPrefix, depthPrefix })
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`The raw run is not the formal A8 series: ${formalRunValidation.failures.join('; ')}`)

  // Function spans and the frontier block from the measured HEAD's source text (never the working tree).
  const registryFiles = [...new Set(analysis.PHASE2C26A8_FUNCTION_REGISTRY.map(entry => entry.file))]
  const sourceTexts = Object.fromEntries(registryFiles.map(file => [file, git('show', `${measuredHead}:${file}`)]))
  const spans = analysis.derivePhase2C26A8FunctionSpans(sourceTexts)
  const frontierBlock = analysis.derivePhase2C26A8FrontierBlock(sourceTexts[analysis.PHASE2C26A8_FRONTIER_BLOCK_MARKERS.file])

  const fileIssues = []
  const analyzeChild = async (child, variant) => {
    const capture = child.capture
    const origin = analysis.phase2c26a8KernelOrigin(child)
    const reconstruction = analysis.reconstructPhase2C26A8FrontierIntervals(child.gogmaRuntime ?? [], origin ?? NaN)
    if (!capture) return { analysis: null, captureIssues: ['no profile capture'], reconstruction }
    const captureIssues = []
    const profileRaw = await readFile(join(profilesDir, capture.profile.file))
    if (sha(profileRaw) !== capture.profile.sha256) captureIssues.push('profile SHA-256 differs from the child record')
    const scriptsRaw = await readFile(join(profilesDir, capture.scripts.file))
    if (sha(scriptsRaw) !== capture.scripts.sha256) captureIssues.push('script table SHA-256 differs from the child record')
    if (capture.window.stoppedBy !== 'window') captureIssues.push(`profile stopped by ${String(capture.window.stoppedBy)}`)
    if (capture.window.error !== null) captureIssues.push(`profile window error ${String(capture.window.error)}`)
    if (origin === null) captureIssues.push('no kernel origin')
    for (const file of a8m.PHASE2C26A8_REQUIRED_SOURCE_FILES) if (capture.scripts.requiredSourceMaps?.[file] !== true) captureIssues.push(`no source map for ${file}`)
    const rows = JSON.parse(scriptsRaw.toString('utf8'))
    const scripts = a5Analysis.createPhase2C26A5ScriptTable(rows, map => new sourceMap.SourceMapConsumer(map))
    const profile = analysis.validatePhase2C26A8CpuProfile(JSON.parse(profileRaw.toString('utf8')))
    const result = analysis.analyzePhase2C26A8Profile(profile, scripts, spans, sourceTexts, frontierBlock, capture.window, reconstruction)
    if (captureIssues.length > 0) fileIssues.push({ id: `${variant}:${child.orientationId}`, issues: captureIssues })
    return { analysis: result, captureIssues, reconstruction }
  }
  const lastHeartbeat = child => [...(child.heartbeats ?? [])].reverse().find(record => record.kind === 'heartbeat') ?? null
  const windowView = window => window && ({ requestedSamplingIntervalUs: window.requestedSamplingIntervalUs, warmupMs: window.warmupMs, profileStopMs: window.profileStopMs,
    requestedProfileDurationMs: window.requestedProfileDurationMs, actualStartElapsedMs: window.actualStartElapsedMs, actualStopElapsedMs: window.actualStopElapsedMs,
    actualProfileDurationMs: window.actualProfileDurationMs, startDelayMs: window.startDelayMs, stopDelayMs: window.stopDelayMs, stoppedBy: window.stoppedBy, error: window.error })
  const reconstructionView = rec => ({ valid: rec.valid, issues: rec.issues, intervals: rec.intervals.length, phaseStartRecords: rec.phaseStartRecords, depthRecords: rec.depthRecords,
    openFrontier: rec.openFrontier, gapToNextBoundaryMs: rec.gapToNextBoundaryMs })
  const profileView = result => result && {
    alignment: { valid: result.alignment.valid, issues: result.alignment.issues, offsetSpreadMs: result.alignment.offsetSpreadMs, maxPairPrecisionMs: result.alignment.maxPairPrecisionMs,
      profileDurationMs: result.alignment.profileDurationMs, sumDeltasMs: result.alignment.sumDeltasMs, negativeDeltas: result.alignment.negativeDeltas },
    intervalValidation: result.intervalValidation,
    allProfileSamples: result.allProfileSamples, windowSamples: result.windowSamples, observedIntervalUs: result.observedIntervalUs,
    intervalsInProfile: result.intervalsInProfile, intervalMsInProfile: result.intervalMsInProfile, intervalShareOfProfile: result.intervalShareOfProfile,
    frontierSamples: result.frontierSamples, frontierSampleShare: result.frontierSampleShare,
    categories: result.categories, otherReasons: result.otherReasons, leafKinds: result.leafKinds, categoryLeafKinds: result.categoryLeafKinds,
    repositoryAttributedSamples: result.repositoryAttributedSamples, unattributedOrNativeSamples: result.unattributedOrNativeSamples, gcSamples: result.gcSamples,
    registeredInclusive: result.registeredInclusive, topLeaves: result.topLeaves, topStacks: result.topStacks,
    comparatorSamples: result.comparatorSamples, boundarySamples: result.boundarySamples, registeredLineMismatches: result.registeredLineMismatches,
    lineTicks: result.lineTicks, reductionLeafCheck: result.reductionLeafCheck, workInWindow: result.workInWindow,
  }
  const depthTotals = child => {
    const depths = (child.gogmaRuntime ?? []).filter(record => record.kind === 'gogma_depth')
    const sum = key => depths.reduce((total, record) => total + (record.counts?.[key] ?? 0), 0)
    const generatedStates = sum('generatedStates'), frontierStatesAfter = sum('frontierStatesAfter')
    return { completedDepths: depths.length, generatedStates, frontierStatesAfter, representativeCompareCalls: generatedStates - frontierStatesAfter }
  }
  const outcomeView = child => {
    const heartbeat = lastHeartbeat(child)
    return { lastHeartbeatElapsedMs: heartbeat?.elapsedMs ?? null, stage: heartbeat?.stage ?? null, counters: heartbeat?.counters ?? null,
      predictionCounts: heartbeat?.predictionCounts ?? null, activeStack: (heartbeat?.searchRuntime?.activeStack ?? []).map(frame => frame.section),
      activeGogmaPhase: heartbeat?.gogmaRuntime?.activePhase ?? null,
      contractViolations: { outer: heartbeat?.searchRuntime?.contractViolations ?? null, inner: heartbeat?.gogmaRuntime?.contractViolations ?? null } }
  }
  const primaryRows = []
  for (const kernel of r.kernels) {
    const { analysis: result, captureIssues, reconstruction } = await analyzeChild(kernel, 'jit_default')
    const decisionRow = analysis.phase2c26a8DecisionRow(kernel.orientationId, result, [...captureIssues, ...(reconstruction.valid ? [] : ['interval reconstruction invalid'])])
    primaryRows.push({
      orientationId: kernel.orientationId, variant: 'jit_default', childOutcome: kernel.process.outcome, childWallMs: kernel.process.wallMs, killedAtMs: kernel.process.killedAtMs,
      nodeFlags: kernel.process.nodeFlags, searchOutcome: outcomeView(kernel), memory: kernel.memory ?? kernel.process.lastIpcMemory ?? null,
      window: windowView(kernel.capture?.window ?? null),
      scriptTable: kernel.capture?.scripts ? { scriptCount: kernel.capture.scripts.scriptCount, sourceMappedCount: kernel.capture.scripts.sourceMappedCount,
        requiredSourceMaps: kernel.capture.scripts.requiredSourceMaps } : null,
      captureIssues, intervalReconstruction: reconstructionView(reconstruction), profile: profileView(result), decisionRow,
      depthWorkWholeRun: depthTotals(kernel),
      semanticParity: { workPrefix: workPrefix.find(w => w.orientationId === kernel.orientationId)?.prefix ?? null,
        depthPrefix: depthPrefix.find(w => w.orientationId === kernel.orientationId)?.prefix ?? null },
      a7Reference: a7.references.find(row => row.orientationId === kernel.orientationId) ?? null,
      _analysis: result,
    })
  }
  const pooled = analysis.phase2c26a8PooledShares(primaryRows.map(row => ({ valid: row.decisionRow.valid, analysis: row._analysis })))
  const decision = analysis.phase2c26a8Decision(primaryRows.map(row => row.decisionRow), pooled)
  let diagnostic = null
  if (r.diagnostic) {
    const { analysis: result, captureIssues, reconstruction } = await analyzeChild(r.diagnostic, 'no_inlining')
    diagnostic = {
      orientationId: r.diagnostic.orientationId, variant: 'no_inlining', nodeFlags: r.diagnostic.process.nodeFlags,
      productionLike: false,
      note: 'no_inlining（--no-turbo-inlining --no-maglev-inlining）はframeを関数単位で見やすくするdiagnosticであり、Production-like runtimeではない。以下の割合をPrimary（jit_default）の割合として読まず、平均・合算しない。decisionには入れない。',
      selection: r.diagnosticSelection,
      childOutcome: r.diagnostic.process.outcome, stoppedBy: r.diagnostic.diagnosticStoppedBy, childWallMs: r.diagnostic.process.wallMs,
      window: windowView(r.diagnostic.capture?.window ?? null), captureIssues, intervalReconstruction: reconstructionView(reconstruction), profile: profileView(result),
      diagnosticRow: analysis.phase2c26a8DecisionRow(r.diagnostic.orientationId, result, [...captureIssues, ...(reconstruction.valid ? [] : ['interval reconstruction invalid'])]),
      semanticParityDescriptive: { workPrefix: a6Analysis.comparePhase2C26A6WorkPrefix(a7Kernel(r.diagnostic.orientationId), r.diagnostic),
        depthPrefix: analysis.comparePhase2C26A8DepthPrefix(a7Kernel(r.diagnostic.orientationId), r.diagnostic) },
    }
  }
  const pct = value => `${(value * 100).toFixed(1)}%`
  const childStatus = Object.fromEntries(['completed', 'out_of_memory', 'timeout', 'process_failure'].map(status => [status, primaryRows.filter(row => row.childOutcome === status).length]))
  const formal = formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0 && fileIssues.length === 0
  const sum = values => values.reduce((total, value) => total + (value ?? 0), 0)
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A8: frontier_reduction_sort internal CPU attribution (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: c26aFile.source, c26a2Result: a2File.source, c26a3Result: a3File.source, c26a4Result: a4File.source, c26a5Result: a5File.source,
      c26a6Result: a6File.source, c26a7Result: a7File.source, a7Run: a7Raw.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      analysisCodeChangedSinceMeasuredHead, postHocAllowedFiles: POST_HOC_ALLOWED, formal, benchmarkCodeSha256: r.environment.benchmarkCodeSha256,
      uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c26aResultSha256: shas.c26a, c26aResultRecordedByRunner: r.environment.c26aResultSha256, c26aMeasuredHead: c26a.measuredHead,
      c26a2ResultSha256: shas.a2, c26a2ResultRecordedByRunner: r.environment.c26a2ResultSha256, c26a2MeasuredHead: a2.measuredHead,
      c26a3ResultSha256: shas.a3, c26a3ResultRecordedByRunner: r.environment.c26a3ResultSha256, c26a3MeasuredHead: a3.measuredHead,
      c26a4ResultSha256: shas.a4, c26a4ResultRecordedByRunner: r.environment.c26a4ResultSha256, c26a4MeasuredHead: a4.measuredHead,
      c26a5ResultSha256: shas.a5, c26a5ResultRecordedByRunner: r.environment.c26a5ResultSha256, c26a5MeasuredHead: a5.measuredHead,
      c26a6ResultSha256: shas.a6, c26a6ResultRecordedByRunner: r.environment.c26a6ResultSha256, c26a6MeasuredHead: a6.measuredHead,
      c26a7ResultSha256: shas.a7, c26a7ResultRecordedByRunner: r.environment.c26a7ResultSha256, c26a7MeasuredHead: a7.measuredHead,
      a7RunSha256: a7Raw.source.sha256, a7RunShaRecordedByA7: a7.runSha256, a7RawShaMatches,
      authorityShaChain: {
        c26aShaRecordedByA7: a7File.json.provenance.c26aResultSha256, a2ShaRecordedByA7: a7File.json.provenance.c26a2ResultSha256,
        a3ShaRecordedByA7: a7File.json.provenance.c26a3ResultSha256, a4ShaRecordedByA7: a7File.json.provenance.c26a4ResultSha256,
        a5ShaRecordedByA7: a7File.json.provenance.c26a5ResultSha256, a6ShaRecordedByA7: a7File.json.provenance.c26a6ResultSha256,
        a7ChainRecordedByA7: a7File.json.provenance.authorityShaChain, allMatchFilesRead: true,
      },
      productionChange: {
        registered: a8m.PHASE2C26A8_PRODUCTION_CHANGE,
        recordedByRunner: r.environment.productionChange,
        rederivedSinceA7MeasuredHead: formalRunValidation.productionChangeRederived,
      },
      profileFileIssues: fileIssues,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    researchOnly: {
      productionCalculationChanges: 0,
      unchanged: ['src/domain/search/bonusStream.ts (frontier reduction algorithm, frontier key, Map, compareReservedRepresentative, compareReservedFrontier, sort, state generation)',
        'stableStringify / compareStableKeys', 'Candidate semantics / Search ordering / extent / bounds / Planner / RNG / schema / version / Persistence / UI',
        'the existing Production observer seams (A3 ReservedGogmaRuntimeObserver, A4 SearchRuntimeObserver); no new seam'],
      measurement: 'V8 sampling CPU profiler (node:inspector, external observation of the child); the frontier_reduction_sort intervals are rebuilt from the existing A3 held-aware stream',
    },
    selectionRule: {
      source: 'Phase 2-C2.6-A7 RESULT selectionValidation.expected (= its selectionRule.primaryOrientationIds = the A6 / A5 / A4 / A3 selection; no ID fixed in source)',
      registeredCount: a8m.PHASE2C26A8_REGISTERED_PRIMARY_COUNT, primaryOrientationIds: a7.primaryOrientationIds, selectedCount: primaryRows.length,
    },
    a7Authority: { measuredHead: a7.measuredHead, decisionCase: a7.decisionCase, decisionSection: a7.decisionSection, references: a7.references, registered: a8m.PHASE2C26A8_REGISTERED_A7 },
    diagnosticSelection: r.diagnosticSelection,
    conditions: { ...r.currentConditions, nodeFlags: r.environment.nodeFlags, freshChildPerOrientation: true, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      heartbeatIntervalMs: r.environment.heartbeatIntervalMs, retry: 'none (each orientation once)', searchInstrumentation: r.environment.searchInstrumentation,
      cpuProfiler: true,
      conditionNote: 'Every A7 condition is unchanged (A6 / A5 primary conditions, concurrency 1, heap-only Node flags, 30-minute budget, the A7 pair of section observers); the one registered difference is the V8 sampling CPU profiler, so absolute wall time is never compared with A7.',
      diagnosticNodeFlags: r.environment.diagnosticNodeFlags, diagnosticBudgetMs: r.environment.diagnosticBudgetMs },
    profilerProbe: r.probe,
    profilerConfig: { ...r.environment.profiler, method: r.environment.profilerMethod,
      clockAlignment: 'V8 CPU profile timestamps are on the process.hrtime clock; four (performance.now, hrtime) pairs around Profiler.start / stop give the constant offset; startTime / endTime must lie inside the hrtime brackets of the calls (tolerance 1 ms) (the A5 rule, unchanged)',
      windowAnchor: 'the kernel\'s first Search start (first search_runtime section start)' },
    registeredRule: {
      interval: 'from the A3 held-aware stream: [origin + phase_started(frontier_reduction_sort).elapsedMs, + gogma_depth.phaseMs.frontier_reduction_sort) on the Research clock; the next phase_started of the same depth (or the depth completion) is the fail-closed upper bound',
      intervalTolerance: analysis.PHASE2C26A8_INTERVAL_TOLERANCE_MS,
      categories: analysis.PHASE2C26A8_CATEGORIES, categoryRules: analysis.PHASE2C26A8_CATEGORY_RULES, functionRegistry: analysis.PHASE2C26A8_FUNCTION_REGISTRY,
      functionSpansAtMeasuredHead: spans, frontierBlockAtMeasuredHead: frontierBlock,
      decision: analysis.PHASE2C26A8_DECISION_RULE, recommendations: analysis.PHASE2C26A8_RECOMMENDATION,
      population: 'samples whose Research time (profile time - offset) lies in [startMs, endMs) of a rebuilt frontier_reduction_sort interval; samples outside are never in a denominator',
      workCount: 'representativeCompareCalls = generatedStates - frontierStatesAfter: every generated state after the first of its (position, family layout) key calls compareReservedRepresentative exactly once. stableStringify runs twice per call only when lastResetDepth ties, so its call count is not 2 x this (not counted)',
    },
    selectionValidation: formalRunValidation.selection,
    conditionParity: formalRunValidation.conditionParity,
    baselineParity: formalRunValidation.a4FormalRun.valid ? { valid: true, source: 'validatePhase2C26A4FormalRun (C2.6-A authority: summary, ordered IDs, identity, metadata)' } : { valid: false },
    formalSeriesValidation: { ...formalRunValidation, conditionParity: undefined, selection: undefined },
    summary: {
      orientations: primaryRows.length, childStatus,
      primarySearchCompleted: primaryRows.filter(row => row.childOutcome === 'completed').length,
      semanticFailures: primaryRows.filter(row => !(row.semanticParity.workPrefix?.valid && row.semanticParity.depthPrefix?.valid)).length,
      contractViolations: sum(primaryRows.map(row => (row.searchOutcome.contractViolations.outer ?? 0) + (row.searchOutcome.contractViolations.inner ?? 0))),
      deliveredCandidates: sum(primaryRows.map(row => row.searchOutcome.counters?.deliveredCandidates)),
      trialsStarted: sum(primaryRows.map(row => row.searchOutcome.counters?.trialsStarted)),
      fullPlannerRunsStarted: sum(primaryRows.map(row => row.searchOutcome.counters?.fullPlannerRunsStarted)),
      frontierSamples: sum(primaryRows.map(row => row.decisionRow.frontierSamples)),
      pooledShares: pooled, decision,
    },
    perPrimary: primaryRows.map(({ _analysis, ...row }) => row),
    diagnostic,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, wallMs: p.wallMs, killedAtMs: p.killedAtMs ?? null, nodeFlags: p.nodeFlags,
      heartbeatMessages: p.ipc?.heartbeatMessages ?? null, gogmaPhaseStartMessages: p.ipc?.gogmaPhaseStartMessages ?? null, gogmaDepthMessages: p.ipc?.gogmaDepthMessages ?? null,
      maxIpcHeartbeatGapMs: p.ipc?.maxHeartbeatGapMs ?? null, profileCapturedAtMs: p.ipc?.profileCapturedAtMs ?? null,
      lastHeartbeatAgeAtEndMs: p.lastHeartbeatAgeAtEndMs ?? null, stderrTail: p.stderrTail })),
    conclusion: {
      statement: `Phase 2-C2.6-A7のprimary ${primaryRows.length} orientationを、A7と同条件（jit_default、A7の2 observer）にV8 sampling CPU profiler（10 ms、Search開始120〜720秒）を加えて各1回profileした: `
        + `completed ${childStatus.completed}、timeout ${childStatus.timeout}、OOM ${childStatus.out_of_memory}、process failure ${childStatus.process_failure}。`
        + `frontier_reduction_sort interval内sampleの構成: ${primaryRows.map(row => `${row.orientationId} (n=${row.decisionRow.frontierSamples}) ${analysis.PHASE2C26A8_CATEGORIES.map(c => `${c} ${pct(row.decisionRow.shares[c])}`).join(' / ')}`).join('、')}。`
        + `decision case ${decision.case}。`,
      decision,
    },
    limitations: [
      'Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。',
      'CPU profiler（10 ms sampling）が加わるため、A7とのabsolute wall time・30分進行量は比較しない。比較はA8 profile内のsample shareだけ。計算内容はA7 formal rawとの共通prefix（completed work / held-aware depth）で一致を確認した。',
      '各orientation 1回のみ（retryなし）、profile windowはSearch開始後120〜720秒（600秒）の1区間。run間ばらつき・window外の構成は測っていない。',
      'sampling profilerの統計的推定である。個々のgenerated stateの処理時間を直接測ったものではない。',
      'V8はMap get / set、Array.prototype.sortのbuiltin loop、spread（[...byKey.values()]）、JSON.stringify等のbuiltinを独立frameとして出さず、呼び出し元JavaScript frameに帰属させる。reduction_loop_or_inlinedはkey生成・Map操作・loop・frontier配列materialization・sort builtin loop・inline部分を分離しない。Map単独 / sort builtin単独のcostとは言わない。',
      'frontier_sortはcompareReservedFrontier（とその呼び出し先）のsampleで、sort builtin自身のmerge処理は含まない（reduction_loop_or_inlinedに入る）。',
      'TurboFan / Maglevのinlineで関数境界が失われたsampleは *_or_inlined categoryに入る。no_inlining diagnosticは関数単位attributionの補助で、Production-like割合ではない。',
      'lineTicks（positionTicks）はprofile全体の記述的集計でinterval filterしていない。frontier block行はfrontier_reduction_sort内でしか実行されないが、最適化コードのsource positionは近似であり、行単位の帰属は断定しない。',
      'interval境界はA3 trackerのResearch側performance.now() stamp。区間はA3 observerのsection開始時durable write（writeSync + IPC）を含み、そのsampleはobserver_overhead（other_frontier）として分離した。',
      'representativeCompareCallsはgeneratedStates - frontierStatesAfter（現在実装での正確なcompareReservedRepresentative呼び出し回数）。stableStringifyの実際の呼び出し回数はlastResetDepth同値時のみでper-state counterを入れていないため不明。',
      'Vite SSR loaderのimport accessor（module-runner.js / module preambleのexport getter）はProduction bundleには無い。leafKindとして別記した。',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, failures: formalRunValidation.failures, fileIssues, childStatus, pooled,
    decision: { case: decision.case, category: decision.category, reason: decision.reason, valid: decision.validPrimaries, invalid: decision.invalidPrimaries },
    perPrimary: primaryRows.map(row => ({ id: row.orientationId, n: row.decisionRow.frontierSamples, shares: row.decisionRow.shares, largest: row.decisionRow.largestCategory,
      reconstruction: row.intervalReconstruction.valid, comparatorOutside: row.profile?.comparatorSamples, lineMismatches: row.profile?.registeredLineMismatches,
      parity: { work: row.semanticParity.workPrefix?.valid, depth: row.semanticParity.depthPrefix?.valid, commonWorks: row.semanticParity.workPrefix?.commonWorks, commonDepths: row.semanticParity.depthPrefix?.commonDepths } })),
    diagnostic: diagnostic && { id: diagnostic.orientationId, n: diagnostic.profile?.frontierSamples, categories: diagnostic.profile?.categories } }, null, 2))
} finally {
  await server.close()
}
