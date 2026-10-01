// Issue #154 Phase 2-C2.6-A9: post-hoc analysis of one raw run of run-planner-global-phase2c26a9.mjs.
// Reads the raw run, its CPU profiles / script tables (--profiles-dir), the committed Phase 2-C2.6-A .. A8 RESULTs (A8 =
// selection and before-evidence authority) and the A8 formal raw run (accepted only when its SHA-256 is the one the A8
// RESULT recorded), and writes the committed evidence JSON. Runs no Planner and no Search. Before any analysis,
// validatePhase2C26A9FormalRun() (src/benchmarks/plannerGlobalPhase2C26A9Analysis.ts) must prove the run is the formal A9
// series (the A8 primary conditions, the SHA chain, a successful probe, the analyzer's own re-derivation of baseline /
// condition / selection parity, exactly the registered Production change since the A8 measured HEAD with the registered
// optimization in its measured source, complete captures, and parity comparisons covering exactly the A8 primaries);
// each profile / script table must match the SHA-256 its child recorded. The A8 classification, function spans and
// frontier block are read from the measured HEAD's source text. Otherwise no RESULT is written.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import sourceMap from 'source-map-js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), profilesDir = option('--profiles-dir'), outputPath = option('--output'), a8RawPath = option('--a8-raw')
const c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), a3Path = option('--c26a3-result'), a4Path = option('--c26a4-result')
const a5Path = option('--c26a5-result'), a6Path = option('--c26a6-result'), a7Path = option('--c26a7-result'), a8Path = option('--c26a8-result')
if (!runPath || !profilesDir || !outputPath || !a8RawPath || !c26aPath || !a2Path || !a3Path || !a4Path || !a5Path || !a6Path || !a7Path || !a8Path) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a9.mjs --run <raw.json.local> --profiles-dir <dir .local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --c26a4-result docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json --c26a5-result docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json --c26a6-result docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json --c26a7-result docs/PLANNER_GLOBAL_PHASE2C26A7_RESULT.json --c26a8-result docs/PLANNER_GLOBAL_PHASE2C26A8_RESULT.json --a8-raw PLANNER_GLOBAL_PHASE2C26A8_R2_RAW.json.local --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c26aFile = await load(c26aPath), a2File = await load(a2Path), a3File = await load(a3Path), a4File = await load(a4Path)
const a5File = await load(a5Path), a6File = await load(a6Path), a7File = await load(a7Path), a8File = await load(a8Path), a8Raw = await load(a8RawPath)
const r = run.json

// The calculation / measurement code (Production, the Research modules, the runner and everything they load) must be the
// measured HEAD; only the post-hoc files below may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a9.mjs', 'src/benchmarks/plannerGlobalPhase2C26A9Analysis.ts', '*.test.ts']
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
  const a8Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A8Analysis.ts')
  const a9m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A9.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A9Analysis.ts')
  const shas = { c26a: c26aFile.source.sha256, a2: a2File.source.sha256, a3: a3File.source.sha256, a4: a4File.source.sha256, a5: a5File.source.sha256,
    a6: a6File.source.sha256, a7: a7File.source.sha256, a8: a8File.source.sha256 }
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
  const parsedA8 = a9m.parsePhase2C26A8ResultAuthority(a8File.json, { c26a: shas.c26a, a2: shas.a2, a3: shas.a3, a4: shas.a4, a5: shas.a5, a6: shas.a6, a7: shas.a7 }, a7, c26a)
  if (!parsedA8.valid) throw new Error(`The Phase 2-C2.6-A8 RESULT is not the registered authority: ${parsedA8.issues.join('; ')}`)
  const a8 = parsedA8.authority

  // Re-derived from git (committed history, not the runner's record): the Production change between the A8 measured HEAD
  // and this measured HEAD, and the measured source of the optimized file.
  const productionChangeSinceA8 = git('diff', '--name-only', a8.measuredHead, measuredHead, '--', 'src').split(/\r?\n/).filter(Boolean)
  const optimizationSource = a9m.validatePhase2C26A9OptimizationSource(git('show', `${measuredHead}:src/domain/search/bonusStream.ts`))
  // The A8 formal raw run: only the file the A8 RESULT recorded.
  const a8RawShaMatches = a8.runSha256 === a8Raw.source.sha256
  const a8Kernel = id => (a8Raw.json.kernels ?? []).find(kernel => kernel.orientationId === id) ?? null
  const a9Kernel = id => (r.kernels ?? []).find(kernel => kernel.orientationId === id) ?? null
  const ids = a8.primaryOrientationIds
  const workPrefix = ids.map(orientationId => ({ orientationId, prefix: a6Analysis.comparePhase2C26A6WorkPrefix(a8Kernel(orientationId), a9Kernel(orientationId)) }))
  const depthPrefix = ids.map(orientationId => ({ orientationId, prefix: a8Analysis.comparePhase2C26A8DepthPrefix(a8Kernel(orientationId), a9Kernel(orientationId)) }))
  const lifecyclePrefix = ids.map(orientationId => ({ orientationId, prefix: analysis.comparePhase2C26A9LifecyclePrefix(a8Kernel(orientationId), a9Kernel(orientationId)) }))
  const formalRunValidation = analysis.validatePhase2C26A9FormalRun(r, { c26a, a2, a3, a4, a5, a6, a7, a8 }, shas,
    { productionChangeSinceA8, optimizationSource, a8RawShaMatches, workPrefix, depthPrefix, lifecyclePrefix })
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`The raw run is not the formal A9 series: ${formalRunValidation.failures.join('; ')}`)

  // The A8 classification: function spans and the frontier block from the measured HEAD's source text (never the working tree).
  const registryFiles = [...new Set(a8Analysis.PHASE2C26A8_FUNCTION_REGISTRY.map(entry => entry.file))]
  const sourceTexts = Object.fromEntries(registryFiles.map(file => [file, git('show', `${measuredHead}:${file}`)]))
  const spans = a8Analysis.derivePhase2C26A8FunctionSpans(sourceTexts)
  const frontierBlock = a8Analysis.derivePhase2C26A8FrontierBlock(sourceTexts[a8Analysis.PHASE2C26A8_FRONTIER_BLOCK_MARKERS.file])

  const fileIssues = []
  const analyzeChild = async child => {
    const capture = child.capture
    const origin = a8Analysis.phase2c26a8KernelOrigin(child)
    const reconstruction = a8Analysis.reconstructPhase2C26A8FrontierIntervals(child.gogmaRuntime ?? [], origin ?? NaN)
    if (!capture) return { analysis: null, cacheHelper: null, captureIssues: ['no profile capture'], reconstruction }
    const captureIssues = []
    const profileRaw = await readFile(join(profilesDir, capture.profile.file))
    if (sha(profileRaw) !== capture.profile.sha256) captureIssues.push('profile SHA-256 differs from the child record')
    const scriptsRaw = await readFile(join(profilesDir, capture.scripts.file))
    if (sha(scriptsRaw) !== capture.scripts.sha256) captureIssues.push('script table SHA-256 differs from the child record')
    if (capture.window.stoppedBy !== 'window') captureIssues.push(`profile stopped by ${String(capture.window.stoppedBy)}`)
    if (capture.window.error !== null) captureIssues.push(`profile window error ${String(capture.window.error)}`)
    if (origin === null) captureIssues.push('no kernel origin')
    for (const file of a9m.PHASE2C26A9_REQUIRED_SOURCE_FILES) if (capture.scripts.requiredSourceMaps?.[file] !== true) captureIssues.push(`no source map for ${file}`)
    const rows = JSON.parse(scriptsRaw.toString('utf8'))
    const scripts = a5Analysis.createPhase2C26A5ScriptTable(rows, map => new sourceMap.SourceMapConsumer(map))
    const profile = a8Analysis.validatePhase2C26A8CpuProfile(JSON.parse(profileRaw.toString('utf8')))
    const result = a8Analysis.analyzePhase2C26A8Profile(profile, scripts, spans, sourceTexts, frontierBlock, capture.window, reconstruction)
    const cacheHelper = analysis.countPhase2C26A9CacheHelperSamples(profile, scripts, spans, capture.window, reconstruction)
    if (captureIssues.length > 0) fileIssues.push({ id: `jit_default:${child.orientationId}`, issues: captureIssues })
    return { analysis: result, cacheHelper, captureIssues, reconstruction }
  }
  const lastHeartbeat = child => [...(child?.heartbeats ?? [])].reverse().find(record => record.kind === 'heartbeat') ?? null
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
    categories: result.categories, otherReasons: result.otherReasons, leafKinds: result.leafKinds,
    gcSamples: result.gcSamples, registeredInclusive: result.registeredInclusive, topLeaves: result.topLeaves, topStacks: result.topStacks,
    comparatorSamples: result.comparatorSamples, boundarySamples: result.boundarySamples, registeredLineMismatches: result.registeredLineMismatches,
    lineTicks: result.lineTicks, reductionLeafCheck: result.reductionLeafCheck, workInWindow: result.workInWindow,
  }
  const outcomeView = child => {
    const heartbeat = lastHeartbeat(child)
    return { lastHeartbeatElapsedMs: heartbeat?.elapsedMs ?? null, stage: heartbeat?.stage ?? null, counters: heartbeat?.counters ?? null,
      predictionCounts: heartbeat?.predictionCounts ?? null, activeStack: (heartbeat?.searchRuntime?.activeStack ?? []).map(frame => frame.section),
      activeGogmaPhase: heartbeat?.gogmaRuntime?.activePhase ?? null,
      contractViolations: { outer: heartbeat?.searchRuntime?.contractViolations ?? null, inner: heartbeat?.gogmaRuntime?.contractViolations ?? null } }
  }
  const memoryView = child => child?.memory ?? child?.process?.lastIpcMemory ?? lastHeartbeat(child)?.memory?.maxima ?? null
  /** Whole-run Search-side wall: bonus_depth_read and the other A6 phases over every completed Bonus depth work. */
  const workTotals = child => {
    const works = (child?.runtime ?? []).filter(record => record.kind === 'search_work_summary')
    const bonus = works.filter(record => record.section === 'bonus_depth_work')
    const phase = name => bonus.reduce((total, record) => total + (record.phaseMs?.[name] ?? 0), 0)
    return { completedWorks: works.length, bonusDepthWorks: bonus.length, rawSolutions: bonus.reduce((t, w) => t + (w.counts?.rawSolutions ?? 0), 0),
      bonusDepthReadMs: phase('bonus_depth_read') }
  }
  const sum = values => values.reduce((total, value) => total + (value ?? 0), 0)
  const lifecycleOf = child => (child?.events ?? []).filter(record => record.kind === 'lifecycle')
  const lifecycleTypes = child => lifecycleOf(child).map(record => record.event?.type ?? null)
  /** The Search / Target outcome a completed kernel reported (descriptive; null when the child did not get there). */
  const completionOf = child => {
    const events = lifecycleOf(child)
    const search = events.find(record => record.event?.type === 'search_completed')?.event ?? null
    const target = events.find(record => record.event?.type === 'target_completed')?.event ?? null
    return search === null && target === null ? null : { searchCompletedAtMs: events.find(record => record.event?.type === 'search_completed')?.elapsedMs ?? null,
      deliveredCandidates: search?.deliveredCandidates ?? null, exhausted: search?.exhausted ?? null, stoppedByExtent: search?.stoppedByExtent ?? null,
      stoppedByConsumer: search?.stoppedByConsumer ?? null, targetOutcome: target?.outcome ?? null }
  }
  const pct = value => (value === null || value === undefined ? '-' : `${(value * 100).toFixed(1)}%`)
  const fx = value => (value === null || value === undefined ? '-' : value.toFixed(3))

  const primaryRows = []
  for (const kernel of r.kernels) {
    const id = kernel.orientationId
    const { analysis: result, cacheHelper, captureIssues, reconstruction } = await analyzeChild(kernel)
    const decisionRow = a8Analysis.phase2c26a8DecisionRow(id, result, [...captureIssues, ...(reconstruction.valid ? [] : ['interval reconstruction invalid'])])
    const before = a8Kernel(id)
    const direct = analysis.comparePhase2C26A9DirectTiming(before, kernel)
    const reference = a8.references.find(row => row.orientationId === id) ?? null
    const parity = { workPrefix: workPrefix.find(w => w.orientationId === id)?.prefix ?? null, depthPrefix: depthPrefix.find(w => w.orientationId === id)?.prefix ?? null,
      lifecyclePrefix: lifecyclePrefix.find(w => w.orientationId === id)?.prefix ?? null }
    const parityValid = Boolean(parity.workPrefix?.valid && parity.depthPrefix?.valid && parity.lifecyclePrefix?.valid && direct.valid)
    primaryRows.push({
      orientationId: id, variant: 'jit_default', childOutcome: kernel.process.outcome, childWallMs: kernel.process.wallMs, killedAtMs: kernel.process.killedAtMs,
      nodeFlags: kernel.process.nodeFlags, searchOutcome: outcomeView(kernel), memory: memoryView(kernel),
      window: windowView(kernel.capture?.window ?? null),
      scriptTable: kernel.capture?.scripts ? { scriptCount: kernel.capture.scripts.scriptCount, sourceMappedCount: kernel.capture.scripts.sourceMappedCount,
        requiredSourceMaps: kernel.capture.scripts.requiredSourceMaps } : null,
      captureIssues, intervalReconstruction: reconstructionView(reconstruction), profile: profileView(result), cacheHelperSamples: cacheHelper, decisionRow,
      profileQuality: { valid: decisionRow.valid, negativeTimeDeltas: decisionRow.negativeTimeDeltas, invalidReasons: decisionRow.invalidReasons,
        a8Valid: reference?.profileValid ?? null, formalComparison: Boolean(reference?.profileValid),
        note: reference?.profileValid ? 'A8 profile valid: the formal before / after profile share comparison uses this primary (when the A9 profile is valid too).'
          : 'A8 profile invalid: never a before value; the A9 share (when valid) is an A9-only after value.' },
      directTiming: direct,
      wholeRun: { a9: analysis.phase2c26a9WholeRunTotals(kernel), a8: analysis.phase2c26a9WholeRunTotals(before), a9Work: workTotals(kernel), a8Work: workTotals(before),
        a8SearchOutcome: outcomeView(before), a8Memory: memoryView(before) },
      semanticParity: { ...parity, directTimingPrefix: { valid: direct.valid, issues: direct.issues, commonDepths: direct.commonDepths }, valid: parityValid },
      a8Reference: reference,
    })
  }
  const comparisonRows = primaryRows.filter(row => row.a8Reference?.profileValid).map(row => analysis.phase2c26a9ComparisonRow(row.orientationId,
    { share: row.a8Reference.shares[analysis.PHASE2C26A9_SERIALIZATION_CATEGORY] }, row.decisionRow, row.directTiming))
  const decision = analysis.phase2c26a9Decision(comparisonRows, primaryRows.map(row => ({ orientationId: row.orientationId, valid: row.semanticParity.valid })))
  const childStatus = Object.fromEntries(['completed', 'out_of_memory', 'timeout', 'process_failure'].map(status => [status, primaryRows.filter(row => row.childOutcome === status).length]))
  const formal = formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0 && fileIssues.length === 0
  /** The child outcome limitation, from the measured child outcomes and the completed kernels' lifecycle (never a fixed premise). */
  const outcomeLimitation = () => {
    const ids = outcome => primaryRows.filter(row => row.childOutcome === outcome).map(row => row.orientationId)
    const completedRows = primaryRows.filter(row => row.childOutcome === 'completed')
    const completions = completedRows.map(row => completionOf(a9Kernel(row.orientationId)))
    const parts = []
    if (ids('timeout').length > 0) parts.push(`${ids('timeout').join(' / ')}は30分budgetでtimeoutし、Search完了までの総時間は測れていない。`)
    if (completedRows.length > 0) {
      const outcomes = [...new Set(completions.map(c => c?.targetOutcome ?? 'unknown'))].join(' / ')
      const delivered = completions.map(c => c?.deliveredCandidates ?? null)
      parts.push(`${completedRows.map(row => row.orientationId).join(' / ')}はSearchとkernelを完走した（target outcome ${outcomes}、deliveredCandidates ${delivered.join(' / ')}）`
        + `${delivered.every(n => n === 0) ? '。いずれもextent内Candidate 0' : ''}。`)
    }
    for (const outcome of ['out_of_memory', 'process_failure']) if (ids(outcome).length > 0) parts.push(`${ids(outcome).join(' / ')}は${outcome}。`)
    parts.push('route quality改善は本Phaseの評価対象ではない。')
    return parts.join('')
  }
  const serial = analysis.PHASE2C26A9_SERIALIZATION_CATEGORY
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A9: frontier_reduction_sort optimization effect (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: c26aFile.source, c26a2Result: a2File.source, c26a3Result: a3File.source, c26a4Result: a4File.source, c26a5Result: a5File.source,
      c26a6Result: a6File.source, c26a7Result: a7File.source, c26a8Result: a8File.source, a8Run: a8Raw.source },
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
      c26a8ResultSha256: shas.a8, c26a8ResultRecordedByRunner: r.environment.c26a8ResultSha256, c26a8MeasuredHead: a8.measuredHead,
      a8RunSha256: a8Raw.source.sha256, a8RunShaRecordedByA8: a8.runSha256, a8RawShaMatches,
      authorityShaChain: {
        c26aShaRecordedByA8: a8File.json.provenance.c26aResultSha256, a2ShaRecordedByA8: a8File.json.provenance.c26a2ResultSha256,
        a3ShaRecordedByA8: a8File.json.provenance.c26a3ResultSha256, a4ShaRecordedByA8: a8File.json.provenance.c26a4ResultSha256,
        a5ShaRecordedByA8: a8File.json.provenance.c26a5ResultSha256, a6ShaRecordedByA8: a8File.json.provenance.c26a6ResultSha256,
        a7ShaRecordedByA8: a8File.json.provenance.c26a7ResultSha256, a8ChainRecordedByA8: a8File.json.provenance.authorityShaChain, allMatchFilesRead: true,
      },
      productionChange: {
        registered: a9m.PHASE2C26A9_PRODUCTION_CHANGE,
        recordedByRunner: r.environment.productionChange,
        rederivedSinceA8MeasuredHead: formalRunValidation.productionChangeRederived,
        optimizationSourceAtMeasuredHead: optimizationSource,
      },
      profileFileIssues: fileIssues,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    productionChange: {
      file: 'src/domain/search/bonusStream.ts',
      function: 'createTargetBonusStream > compareReservedRepresentative (held-aware only)',
      cache: 'reservedBonusStableKeys: WeakMap<RestorationBonusSet, string>, one per createTargetBonusStream() instance (instance-local, never global); key = the five-slot object identity (the Reset / Keep prediction objects the memos hand out); value = the unchanged stableStringify(bonuses) text (never a hash / short key); lazy (computed only when lastResetDepth ties); a cache hit never serializes again; null bonuses are serialized directly',
      unchanged: ['the representative rule (lastResetDepth descending, then the stableStringify text ascending through compareStableKeys)', 'stableStringify / serializeStable / compareStableKeys',
        'the ordinary compareRepresentative()', 'frontier key (position + familyLayoutKey), Map reduction, compareReservedFrontier and the frontier order', 'state generation, raw solutions, canonical history',
        'Reset / Keep prediction and their memo keys', 'reservation window', 'Candidate semantics / Search ordering / extent / bounds / Planner / RNG / schema / version / Persistence / UI'],
    },
    selectionRule: {
      source: 'Phase 2-C2.6-A8 RESULT selectionValidation.expected (= its selectionRule.primaryOrientationIds = the A7 .. A3 selection; no ID fixed in source)',
      registeredCount: a9m.PHASE2C26A9_REGISTERED_PRIMARY_COUNT, primaryOrientationIds: a8.primaryOrientationIds, selectedCount: primaryRows.length,
      comparisonSetSource: 'Phase 2-C2.6-A8 RESULT summary.decision.validPrimaries (the A8 profile-valid primaries)', comparisonSet: a8.validPrimaryOrientationIds,
    },
    a8Authority: { measuredHead: a8.measuredHead, decisionCase: a8.decisionCase, validPrimaryOrientationIds: a8.validPrimaryOrientationIds, references: a8.references,
      registered: a9m.PHASE2C26A9_REGISTERED_A8 },
    conditions: { ...r.currentConditions, nodeFlags: r.environment.nodeFlags, freshChildPerOrientation: true, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      heartbeatIntervalMs: r.environment.heartbeatIntervalMs, retry: 'none (each orientation once)', searchInstrumentation: r.environment.searchInstrumentation,
      cpuProfiler: true, diagnostic: false,
      conditionNote: 'Every A8 primary condition is unchanged (A7 / A6 / A5 conditions, concurrency 1, heap-only Node flags, 30-minute budget, the A7 pair of section observers, the A5 profiler window); the registered difference is the one Production change. No no-inlining diagnostic.' },
    profilerProbe: r.probe,
    profilerConfig: { ...r.environment.profiler, method: r.environment.profilerMethod, windowAnchor: 'the kernel\'s first Search start (first search_runtime section start)' },
    registeredRule: {
      classification: 'the unchanged A8 categories, category rules, function registry, interval reconstruction and profile validity (A8 analysis module, spans and frontier block from the A9 measured HEAD source)',
      categories: a8Analysis.PHASE2C26A8_CATEGORIES, categoryRules: a8Analysis.PHASE2C26A8_CATEGORY_RULES, functionRegistry: a8Analysis.PHASE2C26A8_FUNCTION_REGISTRY,
      functionSpansAtMeasuredHead: spans, frontierBlockAtMeasuredHead: frontierBlock, a8ProfileValidity: a8Analysis.PHASE2C26A8_DECISION_RULE.validity,
      cacheHelper: { ...analysis.PHASE2C26A9_CACHE_HELPER, note: 'not a registered A8 function: a helper sample with a serialization frame below it stays representative_stable_serialization (a cache miss), one without stays representative_compare_or_inlined (the WeakMap lookup); counted descriptively only' },
      directTiming: 'the leading gogma_depth records equal on both sides (A8 depth identity: Target / stream / start / depth / exhausted / counts); frontier_reduction_sort ms (A3 phaseMs) summed over exactly those, per representative comparison (generatedStates - frontierStatesAfter)',
      decision: analysis.PHASE2C26A9_DECISION_RULE, recommendations: analysis.PHASE2C26A9_RECOMMENDATION,
    },
    selectionValidation: formalRunValidation.selection,
    conditionParity: formalRunValidation.conditionParity,
    baselineParity: formalRunValidation.a4FormalRun.valid ? { valid: true, source: 'validatePhase2C26A4FormalRun (C2.6-A authority: summary, ordered IDs, identity, metadata)' } : { valid: false },
    formalSeriesValidation: { ...formalRunValidation, conditionParity: undefined, selection: undefined },
    summary: {
      orientations: primaryRows.length, childStatus,
      primarySearchCompleted: primaryRows.filter(row => row.childOutcome === 'completed').length,
      semanticFailures: primaryRows.filter(row => !row.semanticParity.valid).length,
      contractViolations: sum(primaryRows.map(row => (row.searchOutcome.contractViolations.outer ?? 0) + (row.searchOutcome.contractViolations.inner ?? 0))),
      deliveredCandidates: sum(primaryRows.map(row => row.searchOutcome.counters?.deliveredCandidates)),
      trialsStarted: sum(primaryRows.map(row => row.searchOutcome.counters?.trialsStarted)),
      fullPlannerRunsStarted: sum(primaryRows.map(row => row.searchOutcome.counters?.fullPlannerRunsStarted)),
      profileQuality: { validPrimaries: primaryRows.filter(row => row.decisionRow.valid).length,
        byPrimary: primaryRows.map(row => ({ orientationId: row.orientationId, valid: row.decisionRow.valid, negativeTimeDeltas: row.decisionRow.negativeTimeDeltas,
          frontierSamples: row.decisionRow.frontierSamples, invalidReasons: row.decisionRow.invalidReasons, a8Valid: row.profileQuality.a8Valid })) },
      byPrimary: primaryRows.map(row => ({
        orientationId: row.orientationId, childOutcome: row.childOutcome, a8ProfileValid: row.a8Reference?.profileValid ?? null, a9ProfileValid: row.decisionRow.valid,
        // An A8-invalid profile is never a before value (its share is kept apart as a descriptive value only).
        serializationShare: { a8: row.a8Reference?.profileValid ? row.a8Reference.shares[serial] : null, a9: row.decisionRow.valid ? row.decisionRow.shares[serial] : null,
          a8InvalidProfileDescriptive: row.a8Reference && !row.a8Reference.profileValid ? row.a8Reference.shares[serial] : null },
        lifecycle: { a8: lifecycleTypes(a8Kernel(row.orientationId)), a9: lifecycleTypes(a9Kernel(row.orientationId)), a9Completion: completionOf(a9Kernel(row.orientationId)) },
        a9LargestCategory: row.decisionRow.valid ? row.decisionRow.largestCategory : null,
        frontierCommonPrefix: { commonDepths: row.directTiming.commonDepths, beforeMs: row.directTiming.frontier.beforeMs, afterMs: row.directTiming.frontier.afterMs,
          beforeNsPerCompareCall: row.directTiming.frontier.beforeNsPerCompareCall, afterNsPerCompareCall: row.directTiming.frontier.afterNsPerCompareCall,
          perCompareCallRatio: row.directTiming.frontier.perCompareCallRatio, compareCalls: row.directTiming.before.representativeCompareCalls },
        bonusDepthReadCommonPrefix: row.semanticParity.workPrefix?.phaseTotalsMs?.bonus_depth_read ?? null,
        wholeRun: { a8: { completedDepths: row.wholeRun.a8.depths, generatedStates: row.wholeRun.a8.generatedStates, compareCalls: row.wholeRun.a8.representativeCompareCalls,
          frontierMs: row.wholeRun.a8.sectionMs.frontier_reduction_sort, completedWorks: row.wholeRun.a8Work.completedWorks, bonusDepthReadMs: row.wholeRun.a8Work.bonusDepthReadMs },
        a9: { completedDepths: row.wholeRun.a9.depths, generatedStates: row.wholeRun.a9.generatedStates, compareCalls: row.wholeRun.a9.representativeCompareCalls,
          frontierMs: row.wholeRun.a9.sectionMs.frontier_reduction_sort, completedWorks: row.wholeRun.a9Work.completedWorks, bonusDepthReadMs: row.wholeRun.a9Work.bonusDepthReadMs } },
        semanticParity: row.semanticParity.valid,
      })),
      decision,
    },
    perPrimary: primaryRows,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, wallMs: p.wallMs, killedAtMs: p.killedAtMs ?? null, nodeFlags: p.nodeFlags,
      heartbeatMessages: p.ipc?.heartbeatMessages ?? null, gogmaPhaseStartMessages: p.ipc?.gogmaPhaseStartMessages ?? null, gogmaDepthMessages: p.ipc?.gogmaDepthMessages ?? null,
      maxIpcHeartbeatGapMs: p.ipc?.maxHeartbeatGapMs ?? null, profileCapturedAtMs: p.ipc?.profileCapturedAtMs ?? null,
      lastHeartbeatAgeAtEndMs: p.lastHeartbeatAgeAtEndMs ?? null, stderrTail: p.stderrTail })),
    conclusion: {
      statement: `Phase 2-C2.6-A8のprimary ${primaryRows.length} orientationを、A8 primaryと同条件（jit_default、A7の2 observer、Search開始120〜720秒のCPU profile）でA9 optimization後に各1回計測した: `
        + `completed ${childStatus.completed}、timeout ${childStatus.timeout}、OOM ${childStatus.out_of_memory}、process failure ${childStatus.process_failure}。`
        + `semantic parity（A8 formal rawとの共通prefix）: ${primaryRows.map(row => `${row.orientationId} ${row.semanticParity.valid ? 'valid' : 'MISMATCH'}`).join('、')}。`
        + `representative_stable_serialization share A8 → A9: ${primaryRows.map(row => `${row.orientationId} ${pct(row.a8Reference?.profileValid ? row.a8Reference.shares[serial] : null)} → ${pct(row.decisionRow.valid ? row.decisionRow.shares[serial] : null)}`).join('、')}（A8 / A9でprofile invalidは「-」）。`
        + `frontier_reduction_sort ns / representative comparison（共通prefix）A8 → A9: ${primaryRows.map(row => `${row.orientationId} ${fx(row.directTiming.frontier.beforeNsPerCompareCall)} → ${fx(row.directTiming.frontier.afterNsPerCompareCall)}（${fx(row.directTiming.frontier.perCompareCallRatio)} x）`).join('、')}。`
        + `negative timeDeltas: ${primaryRows.map(row => `${row.orientationId} ${String(row.decisionRow.negativeTimeDeltas)}`).join('、')}。decision case ${decision.case}。`,
      decision,
    },
    limitations: [
      'Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。',
      '各orientation 1回のみ（retryなし）、profile windowはSearch開始後120〜720秒（600秒）の1区間。run間ばらつきは測っていない。',
      'A8 / A9ともCPU profiler（10 ms sampling）がSearch開始120〜720秒に動く。共通prefixの直接時間比較では、A9が同じworkに早く到達するためprofiler区間が対応するworkは両者で一致しない（profiler overhead自体は小さいが厳密には同一ではない）。',
      'CPU sample shareは区間内の構成比であり、速度向上率ではない。速度の比較は共通prefixの直接section時間（frontier_reduction_sort ms / representative comparison）で行った。',
      'negative timeDeltaを1件でも含むCPU profileはprofile全体をinvalid（profile-based decision input外）とした。timestamp補正は行わない。direct section timing・semantic prefix・child outcomeはCPU profile timestampに依存しないため、その記述は有効として扱う。',
      'A8でprofile invalidだったprimaryのA8 profile shareは正式なbefore値として使わない（A9 validならA9単独のafter値として記述する）。',
      'reservedBonusStableKeyはA8の登録関数ではない。cache miss時のserializationはrepresentative_stable_serialization、lookup自体はrepresentative_compare_or_inlinedに入る（A8 ruleのまま）。helper frameの件数は記述的集計のみ。',
      'V8はWeakMap get / set等のbuiltinを独立frameとして出さない場合がある。TurboFan / Maglevのinlineで関数境界が失われたsampleは *_or_inlined categoryに入る。',
      outcomeLimitation(),
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, failures: formalRunValidation.failures, fileIssues, childStatus,
    decision: { case: decision.case, reason: decision.reason, rows: decision.rows },
    byPrimary: evidence.summary.byPrimary }, null, 2))
} finally {
  await server.close()
}
