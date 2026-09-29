// Issue #154 Phase 2-C2.6-A: post-hoc analysis of one raw run of run-planner-global-phase2c26a.mjs.
// Reads the raw run and, post-hoc only, the committed Phase 2-C2 RESULT (the "before"), and writes the committed evidence
// JSON. Runs no Planner and no Search. Before any analysis, validatePhase2C26AFormalRun()
// (src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts, post-hoc, imported by no runner) must prove the run is a complete
// series: exactly one kernel record per orientation the run's own baseline derived. An incomplete run writes no RESULT.
// Then validatePhase2C26AOldC2Comparability() must prove the Phase 2-C2 RESULT is the same measurement (Export, baseline,
// ordered orientations with their Conflict / Entry metadata, extent / bounds, heap, concurrency, budget, ...): only then are
// the old -> current transitions and every other old comparison produced. An incomparable RESULT writes no RESULT.
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
  // 1. The current raw run must be a complete formal series.
  const formalRunValidation = analysis.validatePhase2C26AFormalRun(r, expectations)
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`Formal C2.6-A run is incomplete: ${formalRunValidation.failures.join('; ')}`)

  // 2. - 5. The Phase 2-C2 RESULT, and the proof that it is the same measurement: Export SHA-256, baseline parity, the
  // same orientations in the same order with the same Conflict key / Entry metadata, Production extent / trial bounds, and
  // the Node execution conditions (heap, concurrency, orientation budget, Research maxPlanSteps, yield, CalculationContext).
  const old = analysis.parsePhase2C26AOldC2Result(oldC2.json)
  const oldC2Comparability = analysis.validatePhase2C26AOldC2Comparability(r, old)
  // 6. Fail closed: an incomparable Phase 2-C2 RESULT writes no RESULT (a non-formal diagnostic only drops every old comparison).
  if (!oldC2Comparability.valid && !allowNonformal) throw new Error(`The Phase 2-C2 RESULT is not comparable with this run: ${oldC2Comparability.issues.join('; ')}`)
  const comparable = oldC2Comparability.valid

  // 7. Aggregation, and the before / after comparison only for a comparable Phase 2-C2 RESULT.
  const baseline = r.baseline.record
  const orientations = baseline.orientations
  const kernels = r.kernels
  const summary = analysis.summarizePhase2C26AKernels(kernels)
  const oldComparison = comparable ? analysis.comparePhase2C26AWithOldC2(oldC2Comparability, old, kernels, orientations, sha) : null
  const participants = oldComparison?.participants ?? analysis.phase2c26aParticipantCoverage(orientations, kernels, null)
  const conclusion = analysis.phase2c26aConclusion(summary.childStatus, kernels.length, oldComparison?.transitions.oldOutOfMemory.total ?? null)
  const perOrientation = kernels.map(kernel => analysis.compactPhase2C26AKernel(kernel, comparable ? old.rows.get(kernel.orientationId) ?? null : null, sha,
    kernel.process.outcome === 'out_of_memory' ? c25a.parsePhase2C25AV8FatalGcTrace(kernel.process.stderrTail) : null))
  const failures = perOrientation.filter(row => row.child.outcome !== 'completed')
    .map(row => ({ orientationId: row.orientationId, kind: row.kind, fixedTargetWeaponId: row.fixedTargetWeaponId, outcome: row.child.outcome, wallMs: row.child.wallMs,
      lastIpcYields: row.child.lastIpcYields, memory: row.memory, v8FatalGc: row.v8FatalGc, stderrTail: row.child.stderrTail,
      targetOutcomeProgress: 'not observable: the kernel API exposes no per-Target progress and the child wrote no record' }))
  // 8. The RESULT.
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A: post-H1 Global Planner kernel re-evaluation (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, oldC2Result: oldC2.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: POST_HOC_ALLOWED, formal: formalRunValidation.valid && comparable && calculationCodeChangedSinceMeasuredHead.length === 0,
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
    baseline: { summary: baseline.summary, orientations: orientations.length, process: { outcome: r.baseline.process.outcome, wallMs: r.baseline.process.wallMs }, memory: r.baseline.memory },
    orientations,
    formalRunValidation: { validator: 'validatePhase2C26AFormalRun (post-hoc, src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts)', ...formalRunValidation },
    oldC2Comparability: { validator: 'validatePhase2C26AOldC2Comparability (post-hoc, src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts); every old comparison below exists only when valid', ...oldC2Comparability },
    kernel: summary,
    trialRejectionBeforeAfter: oldComparison?.trialRejectionBeforeAfter ?? null,
    targetOutcomeBeforeAfter: oldComparison?.targetOutcomeBeforeAfter ?? null,
    transitions: oldComparison?.transitions ?? null,
    oldCompletedSemantics: oldComparison?.oldCompletedSemantics ?? null,
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
  console.log(JSON.stringify({ output: outputPath, formal: evidence.provenance.formal, formalRunValidation: formalRunValidation.valid,
    oldC2Comparability: { valid: oldC2Comparability.valid, issues: oldC2Comparability.issues }, childStatus: summary.childStatus,
    transitions: oldComparison?.transitions.matrix ?? null, oldCompletedSemantics: oldComparison?.oldCompletedSemantics ?? null,
    participants: { total: participants.participantsTotal, searched: participants.participantsSearched, notSearched: participants.participantsNotSearched.length }, conclusion: conclusion.case }, null, 2))
} finally {
  await server.close()
}
