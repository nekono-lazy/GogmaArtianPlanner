// Issue #154 Phase 2-C2.6-A: post-hoc analysis of one raw run of run-planner-global-phase2c26a.mjs.
// Reads the raw run and, post-hoc only, the committed Phase 2-C2 RESULT (the "before"), and writes the committed evidence
// JSON. Runs no Planner and no Search. Before any analysis, validatePhase2C26AFormalRun()
// (src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts, post-hoc, imported by no runner) must prove the run is a complete
// series: exactly one kernel record per orientation the run's own baseline derived. An incomplete run writes no RESULT.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), oldC2Path = option('--old-c2'), outputPath = option('--output')
if (!runPath || !oldC2Path || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a.mjs --run <raw.json.local> --old-c2 docs/PLANNER_GLOBAL_PHASE2C2_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), oldC2 = await load(oldC2Path)
const r = run.json

// The calculation code (module, runner and everything they load) must be the measured HEAD; only the post-hoc files below
// may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a.mjs', 'src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts', '*.test.ts']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const analysisCodeUncommitted = Boolean(git('status', '--porcelain', '--', 'src', 'scripts'))

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const c26a = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts')
  const c2 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C2.ts')
  const c25a = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts')
  const expectations = { childHeapLimitMb: c26a.PHASE2C26A_CHILD_HEAP_MB, concurrency: c26a.PHASE2C26A_CONCURRENCY,
    orientationBudgetMs: c26a.PHASE2C26A_ORIENTATION_BUDGET_MS, conditions: c2.phase2c2ProductionDefaultConditions() }
  const formalRunValidation = analysis.validatePhase2C26AFormalRun(r, expectations)
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`Formal C2.6-A run is incomplete: ${formalRunValidation.failures.join('; ')}`)

  const old = analysis.parsePhase2C26AOldC2Result(oldC2.json)
  if (old.exportSha256 !== r.environment.exportSha256) throw new Error('The Phase 2-C2 RESULT was measured on another Export.')
  const baseline = r.baseline.record
  const orientations = baseline.orientations
  const baselineParity = analysis.comparePhase2C26ABaselineWithOldC2(baseline.summary, orientations.length, old)
  const orientationSetParity = analysis.comparePhase2C26AOrientationSets(orientations, old.orientations)
  const conditionParity = { current: { extent: expectations.conditions.extent, bounds: expectations.conditions.bounds }, oldC2: old.conditions,
    matches: JSON.stringify({ extent: expectations.conditions.extent, bounds: expectations.conditions.bounds }) === JSON.stringify(old.conditions),
    heap: { current: r.environment.childHeapLimitMb, oldC2: old.childHeapLimitMb }, concurrency: { current: r.environment.concurrency, oldC2: old.concurrency },
    orientationBudgetMs: { current: r.environment.orientationBudgetMs, oldC2: old.orientationBudgetMs } }

  const kernels = r.kernels
  const summary = analysis.summarizePhase2C26AKernels(kernels)
  const transitions = analysis.phase2c26aTransitions(old, kernels)
  const oldCompletedSemantics = analysis.comparePhase2C26AOldCompletedSemantics(old, kernels, sha)
  const participants = analysis.phase2c26aParticipantCoverage(orientations, kernels, old)
  const conclusion = analysis.phase2c26aConclusion(summary.childStatus, kernels.length, transitions.oldOutOfMemory.total)
  const perOrientation = kernels.map(kernel => analysis.compactPhase2C26AKernel(kernel, old.rows.get(kernel.orientationId) ?? null, sha,
    kernel.process.outcome === 'out_of_memory' ? c25a.parsePhase2C25AV8FatalGcTrace(kernel.process.stderrTail) : null))
  const failures = perOrientation.filter(row => row.child.outcome !== 'completed')
    .map(row => ({ orientationId: row.orientationId, kind: row.kind, fixedTargetWeaponId: row.fixedTargetWeaponId, outcome: row.child.outcome, wallMs: row.child.wallMs,
      lastIpcYields: row.child.lastIpcYields, memory: row.memory, v8FatalGc: row.v8FatalGc, stderrTail: row.child.stderrTail,
      targetOutcomeProgress: 'not observable: the kernel API exposes no per-Target progress and the child wrote no record' }))
  const oldTrialRejectionReasons = old.trialRejectionReasons
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A: post-H1 Global Planner kernel re-evaluation (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, oldC2Result: oldC2.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: POST_HOC_ALLOWED, formal: formalRunValidation.valid && calculationCodeChangedSinceMeasuredHead.length === 0,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      oldC2ResultSha256: oldC2.source.sha256, oldC2MeasuredHead: old.measuredHead, measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    conditions: {
      childHeapLimitMb: r.environment.childHeapLimitMb, nodeFlags: r.environment.nodeFlags, concurrency: r.environment.concurrency, freshChildPerTask: true,
      orientationBudgetMs: r.environment.orientationBudgetMs, baselineBudgetMs: r.environment.baselineBudgetMs, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      nodeYield: r.environment.nodeYield, extent: r.conditions.extent, bounds: r.conditions.bounds,
      captureBoundNote: 'The reused Phase 2-C2 conditions object carries captureBound, which only the (not run) portfolio Search reads; the kernel never reads it.',
      lineage: { priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] },
      calculationContext: r.baseline.calculationContext, researchMaxPlanSteps: r.baseline.researchMaxPlanSteps, rngEngineVersion: r.environment.rngEngineVersion,
      notRun: ['post-hoc portfolio Search', 'capture bound 8', 'extent probe', 'oracle coverage', 'C3 A/B/C readiness', 'global assignment'],
      memoryValues: 'process.memoryUsage() sampled maxima (250 ms), never a true peak; Node heap bytes are not comparable with Browser CDP bytes',
    },
    conditionParityWithOldC2: conditionParity,
    baseline: { summary: baseline.summary, orientations: orientations.length, process: { outcome: r.baseline.process.outcome, wallMs: r.baseline.process.wallMs }, memory: r.baseline.memory },
    baselineParityWithOldC2: baselineParity,
    orientationSetParityWithOldC2: orientationSetParity,
    orientations,
    formalRunValidation: { validator: 'validatePhase2C26AFormalRun (post-hoc, src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts)', ...formalRunValidation },
    kernel: summary,
    trialRejectionBeforeAfter: { oldC2: oldTrialRejectionReasons, current: summary.trials.rejectionReasons,
      explicitDecisionNotSelected: { oldC2: oldTrialRejectionReasons.explicit_decision_not_selected ?? 0, current: summary.trials.rejectionReasons.explicit_decision_not_selected ?? 0 } },
    targetOutcomeBeforeAfter: { oldC2: old.targetOutcomes, current: summary.targetOutcomes, currentOther: summary.otherTargetOutcomes },
    transitions,
    oldCompletedSemantics,
    participants,
    failures,
    perOrientation,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, exitCode: p.exitCode, signal: p.signal, timedOut: p.timedOut, budgetMs: p.budgetMs, wallMs: p.wallMs, startedAt: p.startedAt })),
    conclusion,
    limitations: [
      'Node child (Vite SSR loader) only; no Browser Worker, no other device or heap condition was measured in this phase.',
      'Memory values are sampled maxima (250 ms), never a true peak; a failed child reports only its last IPC sample before death.',
      'A timeout or an OOM child wrote no record: its per-Target progress inside the kernel is not observable (the kernel API exposes none) and is never read as "no Candidate".',
      'found means only "selected in a kernel trial against that orientation’s fixed Route set"; it is not a completed Plan, a resolved Conflict set, a global assignment or oracle coverage.',
      'No portfolio Search, capture bound, extent probe, oracle coverage or C3 readiness was evaluated; C3 readiness is not judged from this phase.',
      'One formal series; run-to-run wall-time variance was not measured.',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal: evidence.provenance.formal, childStatus: summary.childStatus, transitions: transitions.matrix,
    baselineParity: baselineParity.matches, orientationSetParity: orientationSetParity.matches, participants, conclusion: conclusion.case }, null, 2))
} finally {
  await server.close()
}
