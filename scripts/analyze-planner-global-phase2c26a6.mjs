// Issue #154 Phase 2-C2.6-A6: post-hoc analysis of one raw run of run-planner-global-phase2c26a6.mjs.
// Reads the raw run, the committed Phase 2-C2.6-A / A2 / A3 / A4 / A5 RESULTs (A5 = optimization / selection authority,
// A4 = the formal "before") and the A4 formal raw run (accepted only when its SHA-256 is the one the A4 RESULT recorded),
// and writes the committed evidence JSON. Runs no Planner and no Search. Before any analysis,
// validatePhase2C26A6FormalRun() (src/benchmarks/plannerGlobalPhase2C26A6Analysis.ts) must prove the run is the formal A6
// series: the unchanged A4 formal-run contract, the A4 / A5 SHA chain, the A5 condition and selection parity, the one
// registered Production change since the A4 / A5 measured HEADs (as recorded and as re-derived here from git), and the
// ordered completed-work records equal to A4's on their common prefix (semantic parity). Otherwise no RESULT is written.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), a3Path = option('--c26a3-result')
const a4Path = option('--c26a4-result'), a5Path = option('--c26a5-result'), a4RawPath = option('--a4-raw'), outputPath = option('--output')
if (!runPath || !c26aPath || !a2Path || !a3Path || !a4Path || !a5Path || !a4RawPath || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a6.mjs --run <raw.json.local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --c26a4-result docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json --c26a5-result docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json --a4-raw PLANNER_GLOBAL_PHASE2C26A4_RAW.json.local --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c26aFile = await load(c26aPath), a2File = await load(a2Path), a3File = await load(a3Path)
const a4File = await load(a4Path), a5File = await load(a5Path), a4Raw = await load(a4RawPath)
const r = run.json

// The calculation code (the Production optimization, the Research modules, the runner and everything they load) must be
// the measured HEAD; only the post-hoc files below may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a6.mjs', 'src/benchmarks/plannerGlobalPhase2C26A6Analysis.ts', '*.test.ts']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const analysisCodeUncommitted = Boolean(git('status', '--porcelain', '--', 'src', 'scripts'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const a2m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts')
  const a3m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A3.ts')
  const a4m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A4.ts')
  const a4Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A4Analysis.ts')
  const a5m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5.ts')
  const a6m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A6.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A6Analysis.ts')
  const shas = { c26a: c26aFile.source.sha256, a2: a2File.source.sha256, a3: a3File.source.sha256, a4: a4File.source.sha256, a5: a5File.source.sha256 }
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
  const before = a6m.readPhase2C26A6Before(a4File.json, a5.primaryOrientationIds)
  if (!before.valid) throw new Error(`The A4 "before" rows are malformed: ${before.issues.join('; ')}`)

  // Re-derived from git (committed history, not the runner's record): the Production change between the earlier measured
  // HEADs and this measured HEAD.
  const changedSrc = from => git('diff', '--name-only', from, measuredHead, '--', 'src').split(/\r?\n/).filter(Boolean)
  const productionChangeSinceA4 = changedSrc(a4.measuredHead), productionChangeSinceA5 = changedSrc(a5.measuredHead)
  // The A4 formal raw run: only the file the A4 RESULT recorded.
  const a4RawShaMatches = a4File.json.sources?.run?.sha256 === a4Raw.source.sha256
  const a4Kernel = id => (a4Raw.json.kernels ?? []).find(kernel => kernel.orientationId === id) ?? null
  const workPrefix = a5.primaryOrientationIds.map(orientationId => ({ orientationId,
    prefix: analysis.comparePhase2C26A6WorkPrefix(a4Kernel(orientationId), (r.kernels ?? []).find(kernel => kernel.orientationId === orientationId) ?? null) }))
  const formalRunValidation = analysis.validatePhase2C26A6FormalRun(r, { c26a, a2, a3, a4, a5 }, shas,
    { productionChangeSinceA4, productionChangeSinceA5, a4RawShaMatches, workPrefix })
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`The raw run is not the formal A6 series: ${formalRunValidation.failures.join('; ')}`)
  const formal = formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0

  const reference = id => a3.references.find(row => row.orientationId === id) ?? null
  const rows = r.kernels.map(kernel => a4Analysis.analyzePhase2C26A4Kernel(kernel, sha, reference(kernel.orientationId)))
  const comparisons = rows.map(row => analysis.comparePhase2C26A6Orientation(row, before.rows.find(b => b.orientationId === row.orientationId),
    workPrefix.find(w => w.orientationId === row.orientationId).prefix))
  const summary = analysis.summarizePhase2C26A6(comparisons)
  const a4StyleSummary = a4Analysis.summarizePhase2C26A4(rows)
  const decision = summary.decision
  const pct = value => (value === null || value === undefined ? '-' : `${(value * 100).toFixed(1)}%`)
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A6: allocation-free Bonus multiset equality and formal re-measurement (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: c26aFile.source, c26a2Result: a2File.source, c26a3Result: a3File.source, c26a4Result: a4File.source, c26a5Result: a5File.source,
      a4Run: a4Raw.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: POST_HOC_ALLOWED, formal, benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c26aResultSha256: shas.c26a, c26aResultRecordedByRunner: r.environment.c26aResultSha256, c26aMeasuredHead: c26a.measuredHead,
      c26a2ResultSha256: shas.a2, c26a2ResultRecordedByRunner: r.environment.c26a2ResultSha256, c26a2MeasuredHead: a2.measuredHead,
      c26a3ResultSha256: shas.a3, c26a3ResultRecordedByRunner: r.environment.c26a3ResultSha256, c26a3MeasuredHead: a3.measuredHead,
      c26a4ResultSha256: shas.a4, c26a4ResultRecordedByRunner: r.environment.c26a4ResultSha256, c26a4MeasuredHead: a4.measuredHead,
      c26a5ResultSha256: shas.a5, c26a5ResultRecordedByRunner: r.environment.c26a5ResultSha256, c26a5MeasuredHead: a5.measuredHead,
      a4RunSha256: a4Raw.source.sha256, a4RunShaRecordedByA4: a4File.json.sources?.run?.sha256 ?? null, a4RawShaMatches,
      authorityShaChain: {
        c26aShaRecordedByA5: a5File.json.provenance.c26aResultSha256, a2ShaRecordedByA5: a5File.json.provenance.c26a2ResultSha256,
        a3ShaRecordedByA5: a5File.json.provenance.c26a3ResultSha256, a4ShaRecordedByA5: a5File.json.provenance.c26a4ResultSha256,
        a5ChainRecordedByA5: a5File.json.provenance.authorityShaChain, allMatchFilesRead: true,
      },
      productionChange: {
        registered: a6m.PHASE2C26A6_PRODUCTION_CHANGE,
        recordedByRunner: r.environment.productionChange,
        rederivedSinceA4MeasuredHead: formalRunValidation.productionChangeRederived.sinceA4MeasuredHead,
        rederivedSinceA5MeasuredHead: formalRunValidation.productionChangeRederived.sinceA5MeasuredHead,
      },
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    productionOptimization: {
      file: 'src/domain/models/domainRules.ts', function: 'areRestorationBonusSetsEqual',
      before: 'JSON.stringify([bonusTypeId, bonusRankId]) key + Map count per side, compared by size and per-key count',
      after: 'direct 5 x 5 match: each left slot consumes the first unmatched right slot with equal bonusTypeId and bonusRankId (consumed slots in a bit mask); no string key, Map, array, sort or clone',
      unchanged: ['unordered multiset with duplicate counts', 'identity = bonusTypeId and bonusRankId', 'areRestorationBonusSlotsEqual (Keep / slot order) untouched',
        'satisfiesIdealBonuses: both rank validations, then scope, then the multiset comparison (error timing unchanged)'],
      notDone: ['Target Ideal multiset precompute / prepared representation', 'rank lookup / validation hoist', 'Array.filter replacement', 'notice scan', 'frontier reduction', 'state generation'],
    },
    selectionRule: {
      source: 'Phase 2-C2.6-A5 RESULT selectionValidation.expected (= its selectionRule.primaryOrientationIds = the A4 selection = the A3 selection; no ID fixed in source)',
      registeredCount: a6m.PHASE2C26A6_REGISTERED_PRIMARY_COUNT,
      primaryOrientationIds: a5.primaryOrientationIds,
      selectedCount: rows.length,
    },
    conditions: { ...r.currentConditions, nodeFlags: r.environment.nodeFlags, freshChildPerOrientation: true, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      heartbeatIntervalMs: r.environment.heartbeatIntervalMs, retry: 'none (each orientation once)', searchInstrumentation: r.environment.searchInstrumentation,
      conditionNote: 'Every A4 condition and A4 instrumentation is unchanged (A5 primary conditions, concurrency 1, heap-only Node flags, onSearchRuntime alone); no CPU profiler. The only calculation difference from the A4 measured HEAD is the registered Production change.' },
    registeredRule: {
      primaryEffect: 'bonus_ideal_filter phase time summed over the common completed-work prefix of A4 (before) and A6 (after): the same work records with identical raw solutions',
      semanticParity: 'every completed-work record of the common prefix has equal work identity and counts (raw / Ideal / evaluated solutions, subscribers, retained, exhausted, unsupported)',
      decision: analysis.PHASE2C26A6_DECISION_RULE,
      recommendations: analysis.PHASE2C26A6_RECOMMENDATION,
    },
    selectionValidation: formalRunValidation.selection,
    conditionParity: formalRunValidation.conditionParity,
    baselineParity: formalRunValidation.a4FormalRun.valid ? { valid: true, source: 'validatePhase2C26A4FormalRun (C2.6-A authority: summary, ordered IDs, identity, metadata)' } : { valid: false },
    formalSeriesValidation: { ...formalRunValidation, conditionParity: undefined, selection: undefined },
    summary,
    perOrientation: comparisons,
    a4StyleAfter: { summary: a4StyleSummary, perOrientation: rows },
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, wallMs: p.wallMs, killedAtMs: p.killedAtMs ?? null,
      lifecycleMessages: p.ipc?.lifecycleMessages ?? null, heartbeatMessages: p.ipc?.heartbeatMessages ?? null, sectionStartMessages: p.ipc?.sectionStartMessages ?? null,
      workSummaryMessages: p.ipc?.workSummaryMessages ?? null, searchSummaryMessages: p.ipc?.searchSummaryMessages ?? null,
      maxIpcHeartbeatGapMs: p.ipc?.maxHeartbeatGapMs ?? null, minClockOffsetMs: p.ipc?.minClockOffsetMs ?? null,
      lastHeartbeatAgeAtEndMs: p.lastHeartbeatAgeAtEndMs ?? null, stderrTail: p.stderrTail })),
    conclusion: {
      statement: `Phase 2-C2.6-A5のprimary ${comparisons.length} orientationを、A4と同条件・同instrumentationで、allocation-free multiset equality後に各1回再測定した: `
        + `completed ${summary.childStatus.completed}、timeout ${summary.childStatus.timeout}、OOM ${summary.childStatus.out_of_memory}、process failure ${summary.childStatus.process_failure}、`
        + `primary Search完了 ${summary.primarySearchCompleted}、semantic failure ${summary.semanticFailures}。共通work prefix（同一raw solution）でのbonus_ideal_filter after / before: `
        + `${comparisons.map(c => `${c.orientationId} ${c.prefix.filterRatio ?? '-'}`).join('、')}。30分内のbonus_ideal_filter share: `
        + `${comparisons.map(c => `${c.orientationId} ${pct(c.budget.bonus_ideal_filter.beforeShare)} → ${pct(c.budget.bonus_ideal_filter.afterShare)}`).join('、')}。decision case ${decision.case}。`,
      decision,
    },
    limitations: [
      'Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。',
      '各orientation 1回のみ（retryなし）。run間ばらつきは測っていない。A4 beforeも各1回。',
      '主効果は共通work prefix（A4とA6が同じwork recordを同じraw solution数で完了した範囲）でのphase時間比。30分全体の合計はafterの方が多く処理するため直接比較しない（Search wall share / raw solution 1件あたりの値として併記）。',
      '観測点はSearch完了時、またはtimeoutでは最後のheartbeat。最後のheartbeat以降は未観測（A4と同じ）。',
      'section時間はResearch側performance.now()の差。section内のawaitとtimer、GCはその時openなsectionへ計上される（A4と同じ）。',
      'A4 beforeとA6 afterは別のprocess・別時刻の測定で、machine負荷等の差は制御していない。',
      '1,657-step oracleに近いRouteを見つけられるか、54 orientation全体、Browser Worker、Target Ideal precomputeの追加効果、frontier_reduction_sort / state_generation optimizationの効果はこの測定から言えない。',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, failures: formalRunValidation.failures, summary: { ...summary, pooledPrefixPhaseTotalsMs: undefined },
    perOrientation: comparisons.map(c => ({ id: c.orientationId, outcome: c.outcome, filterRatio: c.prefix.filterRatio, commonWorks: c.prefix.commonWorks,
      span: c.prefix.spanMs, filterShare: [c.budget.bonus_ideal_filter.beforeShare, c.budget.bonus_ideal_filter.afterShare], raw: c.rawSolutions })) }, null, 2))
} finally {
  await server.close()
}
