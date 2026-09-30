// Issue #154 Phase 2-C2.6-A4: post-hoc analysis of one raw run of run-planner-global-phase2c26a4.mjs.
// Reads the raw run and the committed Phase 2-C2.6-A / A2 / A3 RESULTs (the parity / rule / selection authorities), and
// writes the committed evidence JSON. Runs no Planner and no Search. Before any analysis, validatePhase2C26A4FormalRun()
// (src/benchmarks/plannerGlobalPhase2C26A4Analysis.ts) must prove the run is the formal A4 series: the same authority
// files and Export, a clean non-smoke run of committed code at concurrency 1 with only the section boundary observer, the
// analyzer's own re-derivation of baseline / condition / selection parity, and well-formed lifecycle and runtime streams
// with no contract violation per kernel child. Otherwise no RESULT is written.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), a3Path = option('--c26a3-result'), outputPath = option('--output')
if (!runPath || !c26aPath || !a2Path || !a3Path || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a4.mjs --run <raw.json.local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --c26a3-result docs/PLANNER_GLOBAL_PHASE2C26A3_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c26aFile = await load(c26aPath), a2File = await load(a2Path), a3File = await load(a3Path)
const r = run.json

// The calculation code (the section boundary seam in the Search and the scheduler, the Research module, the runner and
// everything they load) must be the measured HEAD; only the post-hoc files below may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a4.mjs', 'src/benchmarks/plannerGlobalPhase2C26A4Analysis.ts', '*.test.ts']
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
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A4Analysis.ts')
  const parsedC26a = a2m.parsePhase2C26AAuthority(c26aFile.json)
  if (!parsedC26a.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedC26a.issues.join('; ')}`)
  const c26a = parsedC26a.authority
  const parsedA2 = a3m.parsePhase2C26A2ResultAuthority(a2File.json, c26aFile.source.sha256, c26a)
  if (!parsedA2.valid) throw new Error(`The Phase 2-C2.6-A2 RESULT is not the registered authority: ${parsedA2.issues.join('; ')}`)
  const a2 = parsedA2.authority
  const parsedA3 = a4m.parsePhase2C26A3ResultAuthority(a3File.json, c26aFile.source.sha256, a2File.source.sha256, a2, c26a)
  if (!parsedA3.valid) throw new Error(`The Phase 2-C2.6-A3 RESULT is not the registered authority: ${parsedA3.issues.join('; ')}`)
  const a3 = parsedA3.authority
  const formalRunValidation = analysis.validatePhase2C26A4FormalRun(r, c26a, a2, a3, { c26a: c26aFile.source.sha256, a2: a2File.source.sha256, a3: a3File.source.sha256 })
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`The raw run is not the formal A4 series: ${formalRunValidation.failures.join('; ')}`)
  const formal = formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0

  const reference = id => a3.references.find(row => row.orientationId === id) ?? null
  const rows = r.kernels.map(kernel => analysis.analyzePhase2C26A4Kernel(kernel, sha, reference(kernel.orientationId)))
  const summary = analysis.summarizePhase2C26A4(rows)
  const decision = summary.decision
  const pct = value => `${(value * 100).toFixed(1)}%`
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A4: Planner Alternative Search outer runtime localization (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: c26aFile.source, c26a2Result: a2File.source, c26a3Result: a3File.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: POST_HOC_ALLOWED, formal, benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c26aResultSha256: c26aFile.source.sha256, c26aResultRecordedByRunner: r.environment.c26aResultSha256, c26aMeasuredHead: c26a.measuredHead,
      c26a2ResultSha256: a2File.source.sha256, c26a2ResultRecordedByRunner: r.environment.c26a2ResultSha256, c26a2MeasuredHead: a2.measuredHead,
      c26a3ResultSha256: a3File.source.sha256, c26a3ResultRecordedByRunner: r.environment.c26a3ResultSha256, c26a3MeasuredHead: a3.measuredHead,
      authorityShaChain: {
        c26aShaRecordedByA2: a2.sha256OfC26aRecorded, c26aShaRecordedByA3: a3File.json.provenance.c26aResultSha256, c26aShaRecordedByA3ForA2: a3File.json.provenance.c26aResultShaRecordedByA2,
        a2ShaRecordedByA3: a3File.json.provenance.c26a2ResultSha256, allMatchFilesRead: true,
      },
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    selectionRule: {
      source: 'Phase 2-C2.6-A3 RESULT selectionValidation.expected (= its selectionRule.derivedPrimaryOrientationIds = the A2 rule re-derived from the A2 RESULT; no ID fixed in source)',
      registeredCount: a4m.PHASE2C26A4_REGISTERED_PRIMARY_COUNT,
      primaryOrientationIds: a3.primaryOrientationIds,
      selectedCount: rows.length,
    },
    conditions: { ...r.currentConditions, nodeFlags: r.environment.nodeFlags, freshChildPerOrientation: true, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      heartbeatIntervalMs: r.environment.heartbeatIntervalMs, retry: 'none (each orientation once)',
      conditionNote: 'Every A3 condition is unchanged (concurrency 1 included); only the Search instrumentation differs, so absolute wall time is never compared with A3.',
      searchInstrumentation: r.environment.searchInstrumentation,
      a3InnerObserverDisabled: 'onGogmaReservedRuntime (A3 section observer) / onGogmaReservedDepth / onSkillReservedDepth / onWorkSettled are not attached; the only Search instrumentation is onSearchRuntime (section boundaries, no scan).',
      recording: 'lifecycle records, one record per durable section start (Search, registration, Bonus / Skill depth work and outer phases, delivery flush), one summary per completed Bonus / Skill depth work and Search, and a 5 s heartbeat with the open section stack: each one synchronous append to an open descriptor + IPC; high-frequency sections aggregated in the child, nothing per solution / subscriber / Candidate / queue operation' },
    registeredRule: {
      coverage: 'sum of the outer categories (every exclusive section except the Search root, plus the kernel time around the Search) / Search wall (A3 denominator: kernel search_started -> observation, trials excluded)',
      coverageThreshold: a4m.PHASE2C26A4_COVERAGE_THRESHOLD, categoryThreshold: a4m.PHASE2C26A4_CATEGORY_THRESHOLD, majority: 2,
      order: ['U: >= 2 primaries coverage < 0.90', 'O: >= 2 covered primaries share an outer category other than bonus_depth_read >= 0.10', 'I: >= 2 covered primaries have bonus_depth_read as the largest category and every other < 0.10', 'M: otherwise'],
      outerCategories: a4m.PHASE2C26A4_OUTER_CATEGORIES,
      sectionCategory: a4m.PHASE2C26A4_SECTION_CATEGORY,
    },
    selectionValidation: formalRunValidation.selection,
    conditionParity: formalRunValidation.conditionParity,
    baselineParity: formalRunValidation.baselineParity && { valid: formalRunValidation.baselineParity.valid, issues: formalRunValidation.baselineParity.issues,
      baselineChecks: formalRunValidation.baselineParity.baseline.checks.map(check => ({ field: check.field, matches: check.matches })),
      orderedIdsMatch: formalRunValidation.baselineParity.orderedIdsMatch, orientationIdentityMismatches: formalRunValidation.baselineParity.orientationSet.mismatches.length,
      orientationMetadataMismatches: formalRunValidation.baselineParity.orientationSet.auxiliaryMismatches.length,
      timeoutOrientationMismatches: formalRunValidation.baselineParity.timeoutOrientationMismatches },
    formalSeriesValidation: { ...formalRunValidation, baselineParity: undefined, conditionParity: undefined, selection: undefined },
    summary,
    transitionsFromA3: rows.map(row => ({ orientationId: row.orientationId, a3: row.a3Reference?.childOutcome ?? null, a4: row.childOutcome,
      note: 'absolute wall time not comparable (different Search instrumentation)' })),
    perOrientation: rows,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, wallMs: p.wallMs, killedAtMs: p.killedAtMs ?? null,
      lifecycleMessages: p.ipc?.lifecycleMessages ?? null, heartbeatMessages: p.ipc?.heartbeatMessages ?? null, sectionStartMessages: p.ipc?.sectionStartMessages ?? null,
      workSummaryMessages: p.ipc?.workSummaryMessages ?? null, searchSummaryMessages: p.ipc?.searchSummaryMessages ?? null,
      maxIpcHeartbeatGapMs: p.ipc?.maxHeartbeatGapMs ?? null, minClockOffsetMs: p.ipc?.minClockOffsetMs ?? null,
      lastHeartbeatAgeAtEndMs: p.lastHeartbeatAgeAtEndMs ?? null, stderrTail: p.stderrTail })),
    conclusion: {
      statement: `Phase 2-C2.6-A3のprimary ${rows.length} orientationを、A3と同条件・Search section境界observerのみで各1回profileした: `
        + `completed ${summary.childStatus.completed}、timeout ${summary.childStatus.timeout}、OOM ${summary.childStatus.out_of_memory}、process failure ${summary.childStatus.process_failure}。`
        + `coverage: ${Object.entries(decision.coverage).map(([id, c]) => `${id} ${c}`).join('、')}。最大outer category: `
        + `${rows.map(row => `${row.orientationId} ${row.primarySearch?.maxCategory ?? '-'} ${row.primarySearch ? pct(row.primarySearch.maxCategoryShare) : '-'}`).join('、')}。decision case ${decision.case}。`,
      decision,
    },
    limitations: [
      'Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。',
      'A3とはSearch instrumentationが異なる（A3 section observerは外し、Search全体のsection境界observerだけを付けた）ため、A3とのabsolute wall time比較はしない。比較はA4 run内のSearch wall構成比だけ。',
      '各orientation 1回のみ（retryなし）。run間ばらつきは測っていない。',
      '観測点はSearch完了時、またはtimeoutでは最後のheartbeat。最後のheartbeat以降（最大約5秒 + heartbeat遅延）は未観測で、unobservedTailMsとして別記する。kill時のactive sectionは最後のdurable section開始記録と最後のheartbeatのopen stackから読み、その経過時間はparentのkill時刻とIPC clock offset（最小値）からの推定。',
      'section時間はResearch側performance.now()の差。section内のawait（checkpoint yield = setImmediate）とその間に走るtimer（250 ms memory sampler、5 s heartbeat）の時間は、その時openなsection（主にcheckpoint sectionとbonus_depth_read）に計上される。',
      'bonus_depth_readはreadReservedDepth()全体を1 leafとして計時する（A3の内部6 sectionは再計時していない）。その内部の内訳はA3 evidenceを別authorityとして参照するだけで、A3 / A4のabsolute millisecondsを加算しない。',
      'queue_dispatch_or_unclassifiedはscheduler_stepとscheduler_settleのsection自身の時間（heap pop / dispatch等、子sectionの間）で、直接の境界に囲まれたremainderである。route_base_workはscheduler所有work sectionを持たないsettle（Route search primitiveがqueueへ登録したRoute base work）で、heap popを含む。',
      'Search rootの自身の時間（delivery loopのbookkeeping、境界間の隙間）だけをunattributedとして残す。container sectionのremainderを除いたstrictCoverageを併記する。',
      'section境界の同期通知（Research child内の集計、durable section開始記録、depth work summary）は計算を変えないが、wall timeへのoverheadはゼロではない。',
      '相関・ns per raw solutionは完了したBonus depth work記録のみの記述統計で、因果を示さない。',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, summary: { childStatus: summary.childStatus, categoryShareOfSearchWall: summary.categoryShareOfSearchWall, pooledCoverage: summary.pooledCoverage, decision } }, null, 2))
} finally {
  await server.close()
}
