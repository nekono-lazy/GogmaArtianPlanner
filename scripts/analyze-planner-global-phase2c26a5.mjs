// Issue #154 Phase 2-C2.6-A5: post-hoc analysis of one raw run of run-planner-global-phase2c26a5.mjs.
// Reads the raw run, its CPU profiles / script tables (--profiles-dir) and the committed Phase 2-C2.6-A / A2 / A3 / A4
// RESULTs, and writes the committed evidence JSON. Runs no Planner and no Search. Before any analysis,
// validatePhase2C26A5FormalRun() (src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts) must prove the run is the formal A5
// series (same authority files and Export, a clean non-smoke run of committed code, a successful profiler probe, the
// registered profiler window / flags, the analyzer's own re-derivation of baseline / condition / selection parity and of
// the diagnostic representative, and complete profile captures); each profile / script table must match the SHA-256 its
// child recorded. The function spans are read from the measured HEAD's source text. Otherwise no RESULT is written.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import sourceMap from 'source-map-js'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), profilesDir = option('--profiles-dir'), outputPath = option('--output')
const c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), a3Path = option('--c26a3-result'), a4Path = option('--c26a4-result')
if (!runPath || !profilesDir || !c26aPath || !a2Path || !a3Path || !a4Path || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a5.mjs --run <raw.json.local> --profiles-dir <dir .local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --c26a4-result docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), raw, source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c26aFile = await load(c26aPath), a2File = await load(a2Path), a3File = await load(a3Path), a4File = await load(a4Path)
const r = run.json

// The calculation code (the Research module, the runner and everything they load) must be the measured HEAD; only the
// post-hoc files below may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a5.mjs', 'src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts', '*.test.ts']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const analysisCodeChangedSinceMeasuredHead = changed.filter(postHocOnly)
const analysisCodeUncommitted = Boolean(git('status', '--porcelain', '--', 'src', 'scripts'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const a2m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts')
  const a3m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A3.ts')
  const a4m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A4.ts')
  const a5m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5Analysis.ts')
  const parsedC26a = a2m.parsePhase2C26AAuthority(c26aFile.json)
  if (!parsedC26a.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedC26a.issues.join('; ')}`)
  const c26a = parsedC26a.authority
  const parsedA2 = a3m.parsePhase2C26A2ResultAuthority(a2File.json, c26aFile.source.sha256, c26a)
  if (!parsedA2.valid) throw new Error(`The Phase 2-C2.6-A2 RESULT is not the registered authority: ${parsedA2.issues.join('; ')}`)
  const a2 = parsedA2.authority
  const parsedA3 = a4m.parsePhase2C26A3ResultAuthority(a3File.json, c26aFile.source.sha256, a2File.source.sha256, a2, c26a)
  if (!parsedA3.valid) throw new Error(`The Phase 2-C2.6-A3 RESULT is not the registered authority: ${parsedA3.issues.join('; ')}`)
  const a3 = parsedA3.authority
  const shas = { c26a: c26aFile.source.sha256, a2: a2File.source.sha256, a3: a3File.source.sha256, a4: a4File.source.sha256 }
  const parsedA4 = a5m.parsePhase2C26A4ResultAuthority(a4File.json, shas, a3, c26a)
  if (!parsedA4.valid) throw new Error(`The Phase 2-C2.6-A4 RESULT is not the registered authority: ${parsedA4.issues.join('; ')}`)
  const a4 = parsedA4.authority
  const formalRunValidation = analysis.validatePhase2C26A5FormalRun(r, c26a, a2, a3, a4, shas)
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`The raw run is not the formal A5 series: ${formalRunValidation.failures.join('; ')}`)

  // Function spans from the measured HEAD's source text (never the working tree).
  const registryFiles = [...new Set(analysis.PHASE2C26A5_FUNCTION_REGISTRY.map(entry => entry.file))]
  const spans = analysis.derivePhase2C26A5FunctionSpans(Object.fromEntries(registryFiles.map(file => [file, git('show', `${measuredHead}:${file}`)])))

  const fileIssues = []
  const analyzeCapture = async (child) => {
    const capture = child.capture
    if (!capture) return { analysis: null, captureIssues: ['no profile capture'] }
    const captureIssues = []
    const profileRaw = await readFile(join(profilesDir, capture.profile.file))
    if (sha(profileRaw) !== capture.profile.sha256) captureIssues.push('profile SHA-256 differs from the child record')
    const scriptsRaw = await readFile(join(profilesDir, capture.scripts.file))
    if (sha(scriptsRaw) !== capture.scripts.sha256) captureIssues.push('script table SHA-256 differs from the child record')
    if (capture.window.stoppedBy !== 'window') captureIssues.push(`profile stopped by ${String(capture.window.stoppedBy)}`)
    if (capture.intervals.violations !== 0) captureIssues.push('filter boundary violations')
    const rows = JSON.parse(scriptsRaw.toString('utf8'))
    const scripts = analysis.createPhase2C26A5ScriptTable(rows, map => new sourceMap.SourceMapConsumer(map))
    const profile = analysis.validatePhase2C26A5CpuProfile(JSON.parse(profileRaw.toString('utf8')))
    const result = analysis.analyzePhase2C26A5Profile(profile, scripts, spans, capture.window, capture.intervals.intervals)
    if (captureIssues.length > 0) fileIssues.push({ id: `${child.variant}:${child.orientationId}`, issues: captureIssues })
    return { analysis: result, captureIssues }
  }
  const lastHeartbeat = child => [...(child.heartbeats ?? [])].reverse().find(record => record.kind === 'heartbeat') ?? null
  const windowView = window => window && ({ requestedSamplingIntervalUs: window.requestedSamplingIntervalUs, warmupMs: window.warmupMs, profileStopMs: window.profileStopMs,
    requestedProfileDurationMs: window.requestedProfileDurationMs, actualStartElapsedMs: window.actualStartElapsedMs, actualStopElapsedMs: window.actualStopElapsedMs,
    actualProfileDurationMs: window.actualProfileDurationMs, startDelayMs: window.startDelayMs, stopDelayMs: window.stopDelayMs, stoppedBy: window.stoppedBy, error: window.error })
  const profileView = result => result && {
    alignment: { valid: result.alignment.valid, issues: result.alignment.issues, offsetSpreadMs: result.alignment.offsetSpreadMs, maxPairPrecisionMs: result.alignment.maxPairPrecisionMs,
      profileDurationMs: result.alignment.profileDurationMs, sumDeltasMs: result.alignment.sumDeltasMs, negativeDeltas: result.alignment.negativeDeltas },
    intervalValidation: result.intervalValidation,
    allProfileSamples: result.allProfileSamples, observedIntervalUs: result.observedIntervalUs,
    intervalsInProfile: result.intervalsInProfile, intervalMsInProfile: result.intervalMsInProfile, intervalShareOfProfile: result.intervalShareOfProfile,
    filterIntervalSamples: result.filterIntervalSamples, filterSampleShare: result.filterSampleShare,
    categories: result.categories, unresolvedShare: result.unresolvedShare, leafKinds: result.leafKinds,
    registeredInclusive: result.registeredInclusive, topLeaves: result.topLeaves, topStacks: result.topStacks,
    registeredOutsideFilterSamples: result.registeredOutsideFilterSamples, boundarySamples: result.boundarySamples,
  }
  const reference = id => a4.references.find(row => row.orientationId === id) ?? null
  const primaryRows = []
  for (const kernel of r.kernels) {
    const { analysis: result, captureIssues } = await analyzeCapture(kernel)
    const heartbeat = lastHeartbeat(kernel)
    const decisionRow = analysis.phase2c26a5DecisionRow(kernel.orientationId, result, captureIssues)
    primaryRows.push({
      orientationId: kernel.orientationId, variant: 'jit_default', childOutcome: kernel.process.outcome, childWallMs: kernel.process.wallMs, killedAtMs: kernel.process.killedAtMs,
      nodeFlags: kernel.process.nodeFlags,
      searchOutcome: { lastHeartbeatElapsedMs: heartbeat?.elapsedMs ?? null, stage: heartbeat?.stage ?? null, counters: heartbeat?.counters ?? null,
        predictionCounts: heartbeat?.predictionCounts ?? null, activeStack: (heartbeat?.searchRuntime?.activeStack ?? []).map(frame => frame.section),
        contractViolations: heartbeat?.searchRuntime?.contractViolations ?? null },
      window: windowView(kernel.capture?.window ?? null),
      intervalSnapshot: kernel.capture ? { recorded: kernel.capture.intervals.intervals.length, completedAfterFreeze: kernel.capture.intervals.completedAfterFreeze,
        openAtSnapshot: kernel.capture.intervals.openAtSnapshot, violations: kernel.capture.intervals.violations } : null,
      scriptTable: kernel.capture?.scripts ? { scriptCount: kernel.capture.scripts.scriptCount, sourceMappedCount: kernel.capture.scripts.sourceMappedCount,
        requiredSourceMaps: kernel.capture.scripts.requiredSourceMaps } : null,
      captureIssues,
      profile: profileView(result),
      decisionRow,
      a4Reference: reference(kernel.orientationId),
      _analysis: result,
    })
  }
  const pooled = analysis.phase2c26a5PooledShares(primaryRows.map(row => ({ valid: row.decisionRow.valid, analysis: row._analysis })))
  const decision = analysis.phase2c26a5Decision(primaryRows.map(row => row.decisionRow), pooled)
  let diagnostic = null
  if (r.diagnostic) {
    const { analysis: result, captureIssues } = await analyzeCapture(r.diagnostic)
    diagnostic = {
      orientationId: r.diagnostic.orientationId, variant: 'no_inlining', nodeFlags: r.diagnostic.process.nodeFlags,
      productionLike: false,
      note: 'no_inlining（--no-turbo-inlining --no-maglev-inlining）はhelperを関数単位で見やすくするdiagnosticであり、Production-like runtimeではない。以下の割合をPrimary（jit_default）の割合として読まず、平均・合算しない。',
      selection: r.diagnosticSelection,
      childOutcome: r.diagnostic.process.outcome, stoppedBy: r.diagnostic.diagnosticStoppedBy, childWallMs: r.diagnostic.process.wallMs,
      window: windowView(r.diagnostic.capture?.window ?? null), captureIssues, profile: profileView(result),
    }
  }
  const pct = value => `${(value * 100).toFixed(1)}%`
  const share = (row, category) => row.decisionRow.shares[category]
  const childStatus = Object.fromEntries(['completed', 'out_of_memory', 'timeout', 'process_failure'].map(status => [status, primaryRows.filter(row => row.childOutcome === status).length]))
  const formal = formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0 && fileIssues.length === 0
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A5: Bonus Ideal filter internal runtime localization (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: c26aFile.source, c26a2Result: a2File.source, c26a3Result: a3File.source, c26a4Result: a4File.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      analysisCodeChangedSinceMeasuredHead, postHocAllowedFiles: POST_HOC_ALLOWED, formal, benchmarkCodeSha256: r.environment.benchmarkCodeSha256,
      uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c26aResultSha256: shas.c26a, c26aResultRecordedByRunner: r.environment.c26aResultSha256, c26aMeasuredHead: c26a.measuredHead,
      c26a2ResultSha256: shas.a2, c26a2ResultRecordedByRunner: r.environment.c26a2ResultSha256, c26a2MeasuredHead: a2.measuredHead,
      c26a3ResultSha256: shas.a3, c26a3ResultRecordedByRunner: r.environment.c26a3ResultSha256, c26a3MeasuredHead: a3.measuredHead,
      c26a4ResultSha256: shas.a4, c26a4ResultRecordedByRunner: r.environment.c26a4ResultSha256, c26a4MeasuredHead: a4.measuredHead,
      authorityShaChain: {
        c26aShaRecordedByA4: a4File.json.provenance.c26aResultSha256, a2ShaRecordedByA4: a4File.json.provenance.c26a2ResultSha256,
        a3ShaRecordedByA4: a4File.json.provenance.c26a3ResultSha256, a4ChainRecordedByA4: a4File.json.provenance.authorityShaChain, allMatchFilesRead: true,
      },
      profileFileIssues: fileIssues,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    selectionRule: {
      source: 'Phase 2-C2.6-A4 RESULT selectionValidation.expected (= its selectionRule.primaryOrientationIds = the A3 selection; no ID fixed in source)',
      registeredCount: a5m.PHASE2C26A5_REGISTERED_PRIMARY_COUNT, primaryOrientationIds: a4.primaryOrientationIds, selectedCount: primaryRows.length,
    },
    diagnosticSelection: r.diagnosticSelection,
    conditions: { ...r.currentConditions, freshChildPerOrientation: true, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      heartbeatIntervalMs: r.environment.heartbeatIntervalMs, retry: 'none (each orientation once)', searchInstrumentation: r.environment.searchInstrumentation,
      conditionNote: 'Every A4 condition is unchanged (concurrency 1 and the primary Node flags included); only the CPU profiler (and the filter interval stamps on A4\'s own observer) is added, so absolute wall time is never compared with A4.',
      diagnosticNodeFlags: r.environment.diagnosticNodeFlags, diagnosticBudgetMs: r.environment.diagnosticBudgetMs },
    profilerProbe: r.probe,
    profilerConfig: { ...r.environment.profiler, method: r.environment.profilerMethod,
      clockAlignment: 'V8 CPU profile timestamps are on the process.hrtime clock; four (performance.now, hrtime) pairs around Profiler.start / stop give the constant offset; startTime / endTime must lie inside the hrtime brackets of the calls (tolerance 1 ms)',
      windowAnchor: 'the kernel\'s first Search start (first search_runtime section start)' },
    registeredRule: {
      categories: analysis.PHASE2C26A5_CATEGORIES, categoryRules: analysis.PHASE2C26A5_CATEGORY_RULES, functionRegistry: analysis.PHASE2C26A5_FUNCTION_REGISTRY,
      filterCallSiteFile: analysis.PHASE2C26A5_FILTER_CALL_SITE_FILE, functionSpansAtMeasuredHead: spans, unresolvedCategories: analysis.PHASE2C26A5_UNRESOLVED_CATEGORIES,
      decision: analysis.PHASE2C26A5_DECISION_RULE, clockToleranceMs: analysis.PHASE2C26A5_CLOCK_TOLERANCE_MS,
      population: 'samples whose Research time (profile time - offset) lies in [startMs, endMs) of a bonus_ideal_filter interval; filter-external samples are never in a denominator',
    },
    selectionValidation: formalRunValidation.selection,
    conditionParity: formalRunValidation.conditionParity,
    baselineParity: formalRunValidation.baselineParity && { valid: formalRunValidation.baselineParity.valid, issues: formalRunValidation.baselineParity.issues,
      baselineChecks: formalRunValidation.baselineParity.baseline.checks.map(check => ({ field: check.field, matches: check.matches })),
      orderedIdsMatch: formalRunValidation.baselineParity.orderedIdsMatch, orientationIdentityMismatches: formalRunValidation.baselineParity.orientationSet.mismatches.length,
      orientationMetadataMismatches: formalRunValidation.baselineParity.orientationSet.auxiliaryMismatches.length,
      timeoutOrientationMismatches: formalRunValidation.baselineParity.timeoutOrientationMismatches },
    formalSeriesValidation: { ...formalRunValidation, baselineParity: undefined, conditionParity: undefined, selection: undefined },
    summary: { orientations: primaryRows.length, childStatus, pooledShares: pooled, decision },
    perPrimary: primaryRows.map(({ _analysis, ...row }) => row),
    diagnostic,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, wallMs: p.wallMs, killedAtMs: p.killedAtMs ?? null, nodeFlags: p.nodeFlags,
      heartbeatMessages: p.ipc?.heartbeatMessages ?? null, maxIpcHeartbeatGapMs: p.ipc?.maxHeartbeatGapMs ?? null, profileCapturedAtMs: p.ipc?.profileCapturedAtMs ?? null,
      lastHeartbeatAgeAtEndMs: p.lastHeartbeatAgeAtEndMs ?? null, stderrTail: p.stderrTail })),
    conclusion: {
      statement: `Phase 2-C2.6-A4のprimary ${primaryRows.length} orientationを、A4と同条件（jit_default）・A4のSearch section境界observerのみにV8 sampling CPU profiler（10 ms、Search開始120〜720秒）を加えて各1回profileした: `
        + `completed ${childStatus.completed}、timeout ${childStatus.timeout}、OOM ${childStatus.out_of_memory}、process failure ${childStatus.process_failure}。`
        + `bonus_ideal_filter interval内sampleの構成: ${primaryRows.map(row => `${row.orientationId} (n=${row.decisionRow.filterIntervalSamples}) rank ${pct(share(row, 'rank_reference_validation'))} / multiset ${pct(share(row, 'multiset_equality'))} / predicate_self ${pct(share(row, 'predicate_self_or_inlined'))} / filter ${pct(share(row, 'filter_or_inlined_predicate'))} / gc ${pct(share(row, 'gc'))} / other ${pct(share(row, 'other_unresolved'))}`).join('、')}。`
        + `decision case ${decision.case}。`,
      decision,
    },
    limitations: [
      'Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。',
      'CPU profiler（10 ms sampling）とfilter interval stampが加わるため、A4とのabsolute wall time・進行量は比較しない。比較はA5 profile内のsample shareだけ。',
      '各orientation 1回のみ（retryなし）、profile windowはSearch開始後120〜720秒（600秒）の1区間。run間ばらつき・window外（warmup中や720秒以降）の構成は測っていない。',
      'sampling profilerの統計的推定である。10 ms間隔のsampleは各filter intervalの時間に比例して入るが、個々のsolution評価の時間を直接測ったものではない。',
      'V8 CPU profileはJIT inline frameを復元するが、復元されないinlineやstack walkの欠落（outer frameのない短いstack）はあり得る。ancestor frameが失われたsampleもregistered frameがstackにあればその分類になり、なければunresolved側に入る。',
      'Ideal側（target.idealBonuses）とfinal側（solution.bonuses）のrank reference validationは同じ関数への2回の呼び出しで、CPU profile（leaf line mode）では呼び出し元の行で分離できない。rank_reference_validationは両者の合計であり、内訳は言えない。',
      'filter_or_inlined_predicateは、filter call site（TargetSearchScheduler.settle内のArray.prototype.filter呼び出しとそのcallback）をleafとするsampleで、builtin loop・callback・callbackへinlineされたpredicateを区別しない。純粋なArray.prototype.filter overheadではない。',
      'gcはV8の(garbage collector) sampleで、filter interval内に入ったもの。どのallocationがGCを起こしたかはCPU profileだけでは確定しない。',
      'Vite SSR loaderのaccessor（module-runner.jsのimport getter = leafKind vite_module_runner、module preambleのexport getter = 元ソース行を持たないRepository frame = leafKind vite_ssr_unmapped）はProduction bundleには無い。分類は登録priorityどおり（registered ancestorがあればその分類、なければother_unresolved）で、leafKindとして別記する。',
      'no-inlining diagnosticは関数単位attributionを見やすくする補助で、Production-like割合ではない（Primary表と平均・合算しない）。',
      'filter interval境界はResearch側のperformance.now() stampで、区間はfilter呼び出しとSearch側のruntime observer呼び出しを含む（A4のdurable記録は区間外になるよう順序付けた）。境界±toleranceのsample数を記述的に併記する。',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, childStatus, pooled, decision: { case: decision.case, reason: decision.reason, valid: decision.validPrimaries },
    perPrimary: primaryRows.map(row => ({ id: row.orientationId, n: row.decisionRow.filterIntervalSamples, shares: row.decisionRow.shares, unresolved: row.decisionRow.unresolvedShare })),
    diagnostic: diagnostic && { id: diagnostic.orientationId, n: diagnostic.profile?.filterIntervalSamples, categories: diagnostic.profile?.categories } }, null, 2))
} finally {
  await server.close()
}
