// Issue #154 Phase 2-C2.6-A7: post-hoc analysis of one raw run of run-planner-global-phase2c26a7.mjs.
// Reads the raw run, the committed Phase 2-C2.6-A / A2 / A3 / A4 / A5 / A6 RESULTs (A6 = selection / bottleneck authority,
// A3 = inner section taxonomy, referenced descriptively only) and the A6 formal raw run (accepted only when its SHA-256 is
// the one the A6 RESULT recorded), and writes the committed evidence JSON. Runs no Planner and no Search. Before any
// analysis, validatePhase2C26A7FormalRun() (src/benchmarks/plannerGlobalPhase2C26A7Analysis.ts) must prove the run is the
// formal A7 series: the A7 instrumentation, the A4 formal-run contract otherwise unchanged, the A4 / A5 / A6 SHA chain,
// the A7 condition and selection parity, no Production change since the A6 measured HEAD (as recorded and as re-derived
// here from git), well-formed held-aware record streams, and the ordered completed-work records equal to A6's on their
// common prefix (semantic parity with and without the held-aware observer). Otherwise no RESULT is written.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), a3Path = option('--c26a3-result')
const a4Path = option('--c26a4-result'), a5Path = option('--c26a5-result'), a6Path = option('--c26a6-result'), a6RawPath = option('--a6-raw'), outputPath = option('--output')
if (!runPath || !c26aPath || !a2Path || !a3Path || !a4Path || !a5Path || !a6Path || !a6RawPath || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a7.mjs --run <raw.json.local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --c26a4-result docs/PLANNER_GLOBAL_PHASE2C26A4_RESULT.json --c26a5-result docs/PLANNER_GLOBAL_PHASE2C26A5_RESULT.json --c26a6-result docs/PLANNER_GLOBAL_PHASE2C26A6_RESULT.json --a6-raw PLANNER_GLOBAL_PHASE2C26A6_RAW.json.local --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c26aFile = await load(c26aPath), a2File = await load(a2Path), a3File = await load(a3Path)
const a4File = await load(a4Path), a5File = await load(a5Path), a6File = await load(a6Path), a6Raw = await load(a6RawPath)
const r = run.json

// The calculation / measurement code (Production, the Research modules, the runner and everything they load) must be the
// measured HEAD; only the post-hoc files below may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a7.mjs', 'src/benchmarks/plannerGlobalPhase2C26A7Analysis.ts', '*.test.ts']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation / measurement code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const analysisCodeUncommitted = Boolean(git('status', '--porcelain', '--', 'src', 'scripts'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const a2m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts')
  const a3m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A3.ts')
  const a4m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A4.ts')
  const a5m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A5.ts')
  const a6m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A6.ts')
  const a6Analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A6Analysis.ts')
  const a7m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A7.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A7Analysis.ts')
  const shas = { c26a: c26aFile.source.sha256, a2: a2File.source.sha256, a3: a3File.source.sha256, a4: a4File.source.sha256, a5: a5File.source.sha256, a6: a6File.source.sha256 }
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

  // Re-derived from git (committed history, not the runner's record): the Production change between the A6 measured HEAD
  // and this measured HEAD.
  const productionChangeSinceA6 = git('diff', '--name-only', a6.measuredHead, measuredHead, '--', 'src').split(/\r?\n/).filter(Boolean)
  // The A6 formal raw run: only the file the A6 RESULT recorded.
  const a6RawShaMatches = a6.runSha256 === a6Raw.source.sha256
  const a6Kernel = id => (a6Raw.json.kernels ?? []).find(kernel => kernel.orientationId === id) ?? null
  const a7Kernel = id => (r.kernels ?? []).find(kernel => kernel.orientationId === id) ?? null
  const workPrefix = a6.primaryOrientationIds.map(orientationId => ({ orientationId, prefix: a6Analysis.comparePhase2C26A6WorkPrefix(a6Kernel(orientationId), a7Kernel(orientationId)) }))
  const formalRunValidation = analysis.validatePhase2C26A7FormalRun(r, { c26a, a2, a3, a4, a5, a6 }, shas, { productionChangeSinceA6, a6RawShaMatches, workPrefix })
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`The raw run is not the formal A7 series: ${formalRunValidation.failures.join('; ')}`)
  const formal = formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0

  const rows = r.kernels.map(kernel => analysis.analyzePhase2C26A7Kernel(kernel, sha,
    a6.references.find(row => row.orientationId === kernel.orientationId) ?? null,
    a3.references.find(row => row.orientationId === kernel.orientationId) ?? null,
    workPrefix.find(w => w.orientationId === kernel.orientationId)?.prefix ?? null))
  const summary = analysis.summarizePhase2C26A7(rows)
  const decision = summary.decision
  const pct = value => (value === null || value === undefined ? '-' : `${(value * 100).toFixed(1)}%`)
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A7: formal re-localization of the bonus_depth_read internal runtime after A6 (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: c26aFile.source, c26a2Result: a2File.source, c26a3Result: a3File.source, c26a4Result: a4File.source, c26a5Result: a5File.source,
      c26a6Result: a6File.source, a6Run: a6Raw.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: POST_HOC_ALLOWED, formal, benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c26aResultSha256: shas.c26a, c26aResultRecordedByRunner: r.environment.c26aResultSha256, c26aMeasuredHead: c26a.measuredHead,
      c26a2ResultSha256: shas.a2, c26a2ResultRecordedByRunner: r.environment.c26a2ResultSha256, c26a2MeasuredHead: a2.measuredHead,
      c26a3ResultSha256: shas.a3, c26a3ResultRecordedByRunner: r.environment.c26a3ResultSha256, c26a3MeasuredHead: a3.measuredHead,
      c26a4ResultSha256: shas.a4, c26a4ResultRecordedByRunner: r.environment.c26a4ResultSha256, c26a4MeasuredHead: a4.measuredHead,
      c26a5ResultSha256: shas.a5, c26a5ResultRecordedByRunner: r.environment.c26a5ResultSha256, c26a5MeasuredHead: a5.measuredHead,
      c26a6ResultSha256: shas.a6, c26a6ResultRecordedByRunner: r.environment.c26a6ResultSha256, c26a6MeasuredHead: a6.measuredHead,
      a6RunSha256: a6Raw.source.sha256, a6RunShaRecordedByA6: a6.runSha256, a6RawShaMatches,
      authorityShaChain: {
        c26aShaRecordedByA6: a6File.json.provenance.c26aResultSha256, a2ShaRecordedByA6: a6File.json.provenance.c26a2ResultSha256,
        a3ShaRecordedByA6: a6File.json.provenance.c26a3ResultSha256, a4ShaRecordedByA6: a6File.json.provenance.c26a4ResultSha256,
        a5ShaRecordedByA6: a6File.json.provenance.c26a5ResultSha256, a6ChainRecordedByA6: a6File.json.provenance.authorityShaChain, allMatchFilesRead: true,
      },
      productionChange: {
        registered: a7m.PHASE2C26A7_PRODUCTION_CHANGE,
        recordedByRunner: r.environment.productionChange,
        rederivedSinceA6MeasuredHead: formalRunValidation.productionChangeRederived,
      },
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    researchOnly: {
      productionCalculationChanges: 0,
      unchanged: ['src/domain/search/bonusStream.ts (calculation, frontier reduction, state generation, keys, Map, sort, Reset parent lookup, Keep scan, prediction memo, ReservedBonusState)',
        'Candidate semantics / Search ordering / extent / bounds / Planner / RNG / schema / version / UI / Persistence'],
      instrumentation: 'the existing A3 held-aware section seam (ReservedGogmaRuntimeObserver) and the existing A4 Search section seam (SearchRuntimeObserver); no new Production seam; no Production caller passes either',
    },
    selectionRule: {
      source: 'Phase 2-C2.6-A6 RESULT selectionValidation.expected (= its selectionRule.primaryOrientationIds = the A5 / A4 / A3 selection; no ID fixed in source)',
      registeredCount: a7m.PHASE2C26A7_REGISTERED_PRIMARY_COUNT,
      primaryOrientationIds: a6.primaryOrientationIds,
      selectedCount: rows.length,
    },
    a6Authority: { measuredHead: a6.measuredHead, decisionCase: a6.decisionCase, references: a6.references,
      registered: a7m.PHASE2C26A7_REGISTERED_A6 },
    conditions: { ...r.currentConditions, nodeFlags: r.environment.nodeFlags, freshChildPerOrientation: true, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      heartbeatIntervalMs: r.environment.heartbeatIntervalMs, retry: 'none (each orientation once)', searchInstrumentation: r.environment.searchInstrumentation,
      cpuProfiler: false,
      conditionNote: 'Every A6 condition is unchanged (A5 primary conditions, concurrency 1, heap-only Node flags, 30-minute budget); the one registered difference is onGogmaReservedRuntime attached beside onSearchRuntime. No CPU profiler. No Production calculation change since the A6 measured HEAD.' },
    registeredRule: {
      connection: 'outer bonus_depth_read (A4 onSearchRuntime leaf around readReservedDepth()) and the six inner sections (A3 onGogmaReservedRuntime) of the same run, at the same observation instant (Search completion, or the last heartbeat whose two snapshots share one frozen clock)',
      innerCoverageOfBonusDepthRead: 'sum(inner six sections) / bonus_depth_read',
      readRemainder: 'bonus_depth_read - sum(inner six sections), split into inside depth_started -> depth_completed but outside the sections, and outside the depth boundaries',
      semanticParity: 'every completed-work record of the common prefix with the A6 formal raw run has equal work identity and counts (raw / Ideal / evaluated solutions, subscribers, retained, exhausted, unsupported)',
      decision: analysis.PHASE2C26A7_DECISION_RULE,
      recommendations: analysis.PHASE2C26A7_RECOMMENDATION,
      sectionNext: analysis.PHASE2C26A7_SECTION_NEXT,
    },
    selectionValidation: formalRunValidation.selection,
    conditionParity: formalRunValidation.conditionParity,
    baselineParity: formalRunValidation.a4FormalRun.valid ? { valid: true, source: 'validatePhase2C26A4FormalRun (C2.6-A authority: summary, ordered IDs, identity, metadata)' } : { valid: false },
    formalSeriesValidation: { ...formalRunValidation, conditionParity: undefined, selection: undefined },
    summary,
    perOrientation: rows,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, wallMs: p.wallMs, killedAtMs: p.killedAtMs ?? null,
      lifecycleMessages: p.ipc?.lifecycleMessages ?? null, heartbeatMessages: p.ipc?.heartbeatMessages ?? null, sectionStartMessages: p.ipc?.sectionStartMessages ?? null,
      workSummaryMessages: p.ipc?.workSummaryMessages ?? null, searchSummaryMessages: p.ipc?.searchSummaryMessages ?? null,
      gogmaPhaseStartMessages: p.ipc?.gogmaPhaseStartMessages ?? null, gogmaDepthMessages: p.ipc?.gogmaDepthMessages ?? null,
      maxIpcHeartbeatGapMs: p.ipc?.maxHeartbeatGapMs ?? null, minClockOffsetMs: p.ipc?.minClockOffsetMs ?? null,
      lastHeartbeatAgeAtEndMs: p.lastHeartbeatAgeAtEndMs ?? null, stderrTail: p.stderrTail })),
    conclusion: {
      statement: `Phase 2-C2.6-A6のprimary ${rows.length} orientationを、A6と同条件で、outer onSearchRuntimeとinner onGogmaReservedRuntimeを同一runで併用して各1回測定した: `
        + `completed ${summary.childStatus.completed}、timeout ${summary.childStatus.timeout}、OOM ${summary.childStatus.out_of_memory}、process failure ${summary.childStatus.process_failure}、`
        + `primary Search完了 ${summary.primarySearchCompleted}、semantic failure ${summary.semanticFailures}。bonus_depth_read share of Search wall: `
        + `${rows.map(row => `${row.orientationId} ${pct(row.outer.bonus_depth_read.shareOfSearchWall)}`).join('、')}。innerCoverageOfBonusDepthRead: `
        + `${rows.map(row => `${row.orientationId} ${pct(row.inner.innerCoverageOfBonusDepthRead)}`).join('、')}。dominant inner section: `
        + `${rows.map(row => `${row.orientationId} ${row.inner.dominantSection} (${pct(row.inner.dominantShareOfBonusDepthRead)} of bonus_depth_read)`).join('、')}。decision case ${decision.case}。`,
      decision,
    },
    limitations: [
      'Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。',
      '各orientation 1回のみ（retryなし）。run間ばらつきは測っていない。',
      'A7はA6よりinstrumentationが多い（held-aware section observer追加、section開始ごとのdurable write + IPC）。A6 / A3とのabsolute Search wall・30分内進行量は比較しない。A3との比較はsection構成の記述的比較のみ。',
      '観測点はSearch完了時、またはtimeoutでは最後のheartbeat（outer / innerの2 snapshotは同一frozen clock）。最後のheartbeat以降は未観測。',
      'section時間はResearch側performance.now()の差。section内のawait（execution.checkpoint()のsetImmediate yield）とその間に走るtimer（heartbeat / memory sample）、GCはその時openなsectionへ計上される。',
      'inner sectionの計時はA3 seamの境界まで。section内部（例: frontier key生成 / stableStringify / Map / sort、Reset parent lookup / Keep scan / prediction）の内訳は測っていない。',
      '1,657-step oracleに近いRouteを見つけられるか、54 orientation全体、optimizationの効果はこの測定から言えない。',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, failures: formalRunValidation.failures, summary,
    perOrientation: rows.map(row => ({ id: row.orientationId, outcome: row.childOutcome, wall: row.searchWallMs, read: row.outer.bonus_depth_read,
      coverage: row.inner.innerCoverageOfBonusDepthRead, dominant: row.inner.dominantSection, remainder: row.inner.readRemainderMs, split: row.inner.remainderSplitMs,
      sections: row.inner.sections.map(s => [s.section, s.shareOfBonusDepthRead]), join: { valid: row.workJoin.valid, joined: row.workJoin.joined, coverage: row.workJoin.coverage },
      prefix: formalRunValidation.workPrefix.find(w => w.orientationId === row.orientationId) })) }, null, 2))
} finally {
  await server.close()
}
