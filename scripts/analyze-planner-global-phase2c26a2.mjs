// Issue #154 Phase 2-C2.6-A2: post-hoc analysis of one raw run of run-planner-global-phase2c26a2.mjs.
// Reads the raw run and the committed Phase 2-C2.6-A RESULT (the selection / parity authority), and writes the committed
// evidence JSON. Runs no Planner and no Search. Before any analysis, validatePhase2C26A2FormalRun()
// (src/benchmarks/plannerGlobalPhase2C26A2Analysis.ts) must prove the run is the formal targeted series: the same
// authority file, a clean non-smoke run of committed code, the analyzer's own re-derivation of baseline / condition /
// selection parity, and a well-formed lifecycle stream per kernel child. Otherwise no RESULT is written.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), authorityPath = option('--c26a-result'), outputPath = option('--output')
if (!runPath || !authorityPath || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a2.mjs --run <raw.json.local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), authorityFile = await load(authorityPath)
const r = run.json

// The calculation code (the observer seam in the kernel, the Research module, the runner and everything they load) must
// be the measured HEAD; only the post-hoc files below may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a2.mjs', 'src/benchmarks/plannerGlobalPhase2C26A2Analysis.ts', '*.test.ts']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const analysisCodeUncommitted = Boolean(git('status', '--porcelain', '--', 'src', 'scripts'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A2Analysis.ts')
  const parsed = analysis.parsePhase2C26AAuthority(authorityFile.json)
  if (!parsed.valid) throw new Error(`The Phase 2-C2.6-A RESULT is not the registered authority: ${parsed.issues.join('; ')}`)
  const authority = parsed.authority
  const formalRunValidation = analysis.validatePhase2C26A2FormalRun(r, authority, authorityFile.source.sha256)
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`The raw run is not the formal targeted series: ${formalRunValidation.failures.join('; ')}`)
  const formal = formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0

  const rows = r.kernels.map(kernel => analysis.analyzePhase2C26A2Kernel(kernel, sha))
  const summary = analysis.summarizePhase2C26A2(rows)
  const participantsNotSearched = Array.isArray(authorityFile.json.participants?.participantsNotSearched) ? authorityFile.json.participants.participantsNotSearched : []
  const unreachedParticipants = participantsNotSearched.map(targetWeaponId => ({
    targetWeaponId,
    inProfiledOrientations: rows.filter(row => row.targets.some(target => target.targetWeaponId === targetWeaponId) || (row.fixedTargetWeaponId !== targetWeaponId
      && r.kernels.find(k => k.orientationId === row.orientationId)?.task.orientation.participantTargetWeaponIds.includes(targetWeaponId)))
      .map(row => {
        const target = row.targets.find(t => t.targetWeaponId === targetWeaponId) ?? null
        return { orientationId: row.orientationId, resultClass: row.resultClass, targetState: target?.state ?? 'not_started', searchStarted: target?.searchStartMs != null,
          searchCompleted: target?.searchEndMs != null, outcome: target?.outcome ?? null, deliveredCandidates: target?.deliveredCandidates ?? 0, trials: target?.trials.length ?? 0 }
      }),
  }))
  const byConflict = new Map()
  for (const kernel of r.kernels) {
    const key = kernel.task.orientation.conflictKey
    if (!byConflict.has(key)) byConflict.set(key, [])
    byConflict.get(key).push(rows.find(row => row.orientationId === kernel.orientationId))
  }
  const conflictGroups = [...byConflict.entries()].map(([conflictKey, group]) => ({
    conflictKey, kind: group[0].kind, orientations: group.map(row => row.orientationId), nonFixedTargetCount: group[0].nonFixedTargetCount,
    reached: group.map(row => ({ orientationId: row.orientationId, resultClass: row.resultClass, startedTargets: row.counters.startedTargets, completedTargets: row.counters.completedTargets,
      activeTargetOrdinal: row.activeTargetOrdinal, activeTargetWeaponId: row.activeTargetWeaponId, dominantStage: row.dominantStage })),
    distinctActiveTargets: [...new Set(group.map(row => row.activeTargetWeaponId).filter(Boolean))],
  }))
  const authorityOutcome = id => authority.outcomeById.get(id) ?? null
  const transitions = rows.map(row => ({ orientationId: row.orientationId, c26a: authorityOutcome(row.orientationId), a2: row.childOutcome }))
  const timeouts = rows.filter(row => row.childOutcome === 'timeout')
  const count = c => summary.resultClass[c]
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A2: timeout orientation targeted runtime analysis (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: authorityFile.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: POST_HOC_ALLOWED, formal, benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c26aResultSha256: authorityFile.source.sha256, c26aResultRecordedByRunner: r.environment.c26aResultSha256, c26aMeasuredHead: authority.measuredHead,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    conditions: { ...r.currentConditions, nodeFlags: r.environment.nodeFlags, freshChildPerOrientation: true, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      heartbeatIntervalMs: r.environment.heartbeatIntervalMs, retry: 'none (each orientation once)',
      instrumentation: 'PlannerAlternativeKernelOptions.instrumentation (lifecycle events) + createPlannerAlternativeSearchObserver() per Target + createCountingRngEngine(); records written synchronously per event, heartbeat every 5 s' },
    selectionValidation: formalRunValidation.selection,
    conditionParity: formalRunValidation.conditionParity,
    baselineParity: formalRunValidation.baselineParity && { valid: formalRunValidation.baselineParity.valid, issues: formalRunValidation.baselineParity.issues,
      baselineChecks: formalRunValidation.baselineParity.baseline.checks.map(check => ({ field: check.field, matches: check.matches })),
      orderedIdsMatch: formalRunValidation.baselineParity.orderedIdsMatch, orientationIdentityMismatches: formalRunValidation.baselineParity.orientationSet.mismatches.length,
      orientationMetadataMismatches: formalRunValidation.baselineParity.orientationSet.auxiliaryMismatches.length,
      timeoutOrientationMismatches: formalRunValidation.baselineParity.timeoutOrientationMismatches },
    formalSeriesValidation: { ...formalRunValidation, baselineParity: undefined, conditionParity: undefined, selection: undefined },
    summary,
    transitionsFromC26A: transitions,
    conflictGroups,
    unreachedParticipants,
    perOrientation: rows.map(analysis.compactPhase2C26A2Row),
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, wallMs: p.wallMs, killedAtMs: p.killedAtMs ?? null, lifecycleMessages: p.ipc?.lifecycleMessages ?? null,
      heartbeatMessages: p.ipc?.heartbeatMessages ?? null, maxIpcHeartbeatGapMs: p.ipc?.maxHeartbeatGapMs ?? null, lastHeartbeatAgeAtEndMs: p.lastHeartbeatAgeAtEndMs ?? null,
      stderrTail: p.stderrTail })),
    conclusion: {
      statement: `C2.6-Aでtimeoutした${rows.length} orientationを同条件で1回ずつprofileした: completed ${summary.childStatus.completed}、timeout ${summary.childStatus.timeout}`
        + `（Search中 ${count('timeout_in_search')}、preflight中 ${count('timeout_in_preflight')}、full Planner run中 ${count('timeout_in_full_planner_run')}、その他 ${count('timeout_elsewhere')}）、`
        + `OOM ${summary.childStatus.out_of_memory}、process failure ${summary.childStatus.process_failure}。`,
      timeoutStageAtEnd: Object.fromEntries(timeouts.map(row => [row.orientationId, row.stageAtEnd])),
      next: summary.next,
    },
    limitations: [
      'Node child（Vite SSR loader）のみ。Browser Worker・他device・他heap条件は測っていない。',
      'concurrency 3はC2.6-Aと同じだが、今回は9件だけをpoolするため同時実行相手は54件seriesと同じではない。wall timeの厳密なbefore / after比較はしない。',
      '各orientation 1回のみ（retryなし）。run間ばらつきは測っていない。',
      'stage時間はlifecycle event間のResearch側時刻差で、最後のheartbeat以降（最大約5秒 + heartbeat遅延）は未観測。timeout時のstage自体は子processが同期書き込みした最後のeventで確定する。',
      'Search内のSkill / Gogma streamの時間配分は直接計時していない（state・transition・prediction数のみ）。',
      'memoryはsampled max（250 ms、heartbeat経由）でtrue peakではない。',
      'instrumentation（per-event同期file書き込み・IPC、Search observerの加算）は計算を変えないが、wall timeへのoverheadはゼロではない。',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, summary: { childStatus: summary.childStatus, resultClass: summary.resultClass, next: summary.next } }, null, 2))
} finally {
  await server.close()
}
