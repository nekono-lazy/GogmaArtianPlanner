// Issue #154 Phase 2-C2.6-A3: post-hoc analysis of one raw run of run-planner-global-phase2c26a3.mjs.
// Reads the raw run and the committed Phase 2-C2.6-A / A2 RESULTs (the parity / selection authorities), and writes the
// committed evidence JSON. Runs no Planner and no Search. Before any analysis, validatePhase2C26A3FormalRun()
// (src/benchmarks/plannerGlobalPhase2C26A3Analysis.ts) must prove the run is the formal A3 series: the same authority files
// and Export, a clean non-smoke run of committed code at concurrency 1 with only the boundary observer, the analyzer's own
// re-derivation of baseline / condition / selection parity, and well-formed lifecycle and runtime streams per kernel
// child. Otherwise no RESULT is written.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), c26aPath = option('--c26a-result'), a2Path = option('--c26a2-result'), outputPath = option('--output')
if (!runPath || !c26aPath || !a2Path || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a3.mjs --run <raw.json.local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --c26a2-result docs/PLANNER_GLOBAL_PHASE2C26A2_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c26aFile = await load(c26aPath), a2File = await load(a2Path)
const r = run.json

// The calculation code (the boundary seam in the Bonus stream, the Research module, the runner and everything they load)
// must be the measured HEAD; only the post-hoc files below may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a3.mjs', 'src/benchmarks/plannerGlobalPhase2C26A3Analysis.ts', '*.test.ts']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const analysisCodeUncommitted = Boolean(git('status', '--porcelain', '--', 'src', 'scripts'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const a2m = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2.ts')
  const a3 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A3.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A3Analysis.ts')
  const parsedC26a = a2m.parsePhase2C26AAuthority(c26aFile.json)
  if (!parsedC26a.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsedC26a.issues.join('; ')}`)
  const c26a = parsedC26a.authority
  const parsedA2 = a3.parsePhase2C26A2ResultAuthority(a2File.json, c26aFile.source.sha256, c26a)
  if (!parsedA2.valid) throw new Error(`The Phase 2-C2.6-A2 RESULT is not the registered authority: ${parsedA2.issues.join('; ')}`)
  const a2 = parsedA2.authority
  const formalRunValidation = analysis.validatePhase2C26A3FormalRun(r, c26a, a2, c26aFile.source.sha256, a2File.source.sha256)
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`The raw run is not the formal A3 series: ${formalRunValidation.failures.join('; ')}`)
  const formal = formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0

  const rows = r.kernels.map(kernel => analysis.analyzePhase2C26A3Kernel(kernel, sha))
  const summary = analysis.summarizePhase2C26A3(rows)
  const a2Row = id => a2.rows.find(row => row.orientationId === id) ?? null
  const decision = summary.decision
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A3: held-aware Gogma stream internal runtime localization (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: c26aFile.source, c26a2Result: a2File.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: POST_HOC_ALLOWED, formal, benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c26aResultSha256: c26aFile.source.sha256, c26aResultRecordedByRunner: r.environment.c26aResultSha256, c26aMeasuredHead: c26a.measuredHead,
      c26a2ResultSha256: a2File.source.sha256, c26a2ResultRecordedByRunner: r.environment.c26a2ResultSha256, c26a2MeasuredHead: a2.measuredHead,
      c26aResultShaRecordedByA2: a2.sha256OfC26aRecorded,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    selectionRule: {
      source: 'Phase 2-C2.6-A2 RESULT perOrientation (derived, no ID fixed in source)',
      rule: 'resultClass == timeout_in_search && counters.startedTargets == 1 && counters.completedTargets == 0 && counters.trialsStarted == 0 && counters.fullPlannerRunsStarted == 0 && activeTargetOrdinal == 0',
      registeredCount: a3.PHASE2C26A3_REGISTERED_PRIMARY_COUNT,
      derivedPrimaryOrientationIds: a2.primaryOrientationIds,
      selectedCount: rows.length,
    },
    conditions: { ...r.currentConditions, nodeFlags: r.environment.nodeFlags, freshChildPerOrientation: true, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      heartbeatIntervalMs: r.environment.heartbeatIntervalMs, retry: 'none (each orientation once)',
      concurrencyNote: 'A3 formal condition concurrency = 1 (C2.6-A / A2: 3). One Search at a time, so section wall time is not shared with sibling children; absolute wall time is never compared with A2.',
      searchInstrumentation: r.environment.searchInstrumentation,
      oldHeavyDepthObserversDisabled: 'onGogmaReservedDepth / onSkillReservedDepth / onWorkSettled are not attached (A2 attached them); the only Search instrumentation is onGogmaReservedRuntime (section boundaries, no scan).',
      recording: 'lifecycle records, one record per Gogma section start and one per completed Gogma depth, and a 5 s heartbeat: each one synchronous append to an open descriptor + IPC; nothing per state' },
    selectionValidation: formalRunValidation.selection,
    conditionParity: formalRunValidation.conditionParity,
    baselineParity: formalRunValidation.baselineParity && { valid: formalRunValidation.baselineParity.valid, issues: formalRunValidation.baselineParity.issues,
      baselineChecks: formalRunValidation.baselineParity.baseline.checks.map(check => ({ field: check.field, matches: check.matches })),
      orderedIdsMatch: formalRunValidation.baselineParity.orderedIdsMatch, orientationIdentityMismatches: formalRunValidation.baselineParity.orientationSet.mismatches.length,
      orientationMetadataMismatches: formalRunValidation.baselineParity.orientationSet.auxiliaryMismatches.length,
      timeoutOrientationMismatches: formalRunValidation.baselineParity.timeoutOrientationMismatches },
    formalSeriesValidation: { ...formalRunValidation, baselineParity: undefined, conditionParity: undefined, selection: undefined },
    summary,
    transitionsFromA2: rows.map(row => ({ orientationId: row.orientationId, a2: a2Row(row.orientationId)?.childOutcome ?? null, a3: row.childOutcome,
      note: 'absolute wall time not comparable (concurrency 3 -> 1, heavy observers removed)' })),
    perOrientation: rows,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, wallMs: p.wallMs, killedAtMs: p.killedAtMs ?? null,
      lifecycleMessages: p.ipc?.lifecycleMessages ?? null, heartbeatMessages: p.ipc?.heartbeatMessages ?? null, phaseStartMessages: p.ipc?.phaseStartMessages ?? null,
      depthMessages: p.ipc?.depthMessages ?? null, maxIpcHeartbeatGapMs: p.ipc?.maxHeartbeatGapMs ?? null, minClockOffsetMs: p.ipc?.minClockOffsetMs ?? null,
      lastHeartbeatAgeAtEndMs: p.lastHeartbeatAgeAtEndMs ?? null, stderrTail: p.stderrTail })),
    conclusion: {
      statement: `Phase 2-C2.6-A2でTarget 1件のSearchだけで30分を使い切った${rows.length} orientationを、concurrency 1・heavy observerなしで各1回profileした: `
        + `completed ${summary.childStatus.completed}、timeout ${summary.childStatus.timeout}、OOM ${summary.childStatus.out_of_memory}、process failure ${summary.childStatus.process_failure}。`
        + `held-aware Gogma sectionのcoverage: ${Object.entries(decision.coverage).map(([id, c]) => `${id} ${c}`).join('、')}。decision case ${decision.case}。`,
      decision,
    },
    limitations: [
      'Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。',
      'concurrency 1はC2.6-A / A2（3）と異なり、heavy depth observerも外したため、A2とのabsolute wall time比較はしない。',
      '各orientation 1回のみ（retryなし）。run間ばらつきは測っていない。',
      'coverageの観測点はSearch完了時、またはtimeoutでは最後のheartbeat。最後のheartbeat以降（最大約5秒 + heartbeat遅延）は未観測で、unobservedTailMsとして別記する。kill時のactive sectionは最後の同期書き込み記録から読み、その経過時間はparentのkill時刻とIPC clock offset（最小値）からの推定。',
      'section時間はResearch側performance.now()の差。section内のawait（checkpoint yield = setImmediate）とその間に走るtimer（250 ms memory sampler、5 s heartbeat）の時間は、その時activeなsection（主にstate_generation）に計上される。',
      'section境界以外（scheduler、Bonus publication、Ideal filter、Lazy Cross、Skill stream、Route base登録等）は直接計時していない（unattributedとして残る）。',
      'section境界記録（phase開始ごとの同期追記 + IPC、depthごとのsummary）は計算を変えないが、wall timeへのoverheadはゼロではない。',
      'depth別分布・相関は完了したdepth記録のみ（timeout時のactive depthは含まない）。相関は記述統計で因果を示さない。',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, summary: { childStatus: summary.childStatus, phaseTotalsMs: summary.phaseTotalsMs, pooledCoverage: summary.pooledCoverage, decision } }, null, 2))
} finally {
  await server.close()
}
