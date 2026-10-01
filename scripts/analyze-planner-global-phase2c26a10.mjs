// Issue #154 Phase 2-C2.6-A10: post-hoc analysis of one raw run of run-planner-global-phase2c26a10.mjs.
// Reads the raw run, the committed Phase 2-C2.6-A RESULT (the "before"), the committed Phase 2-C2.6-A9 RESULT and the
// A2 .. A8 RESULT files it names (authority chain), and writes the committed evidence JSON. Runs no Planner and no Search.
// Order (fail closed): calculation code unchanged since the measured HEAD -> the C2.6-A authority -> the A9 authority
// chain -> the formal A10 series (validatePhase2C26A10FormalRun) -> the comparability with C2.6-A
// (validatePhase2C26A10Comparability) -> only then the before / after (comparePhase2C26A10WithC26A) and the pre-registered
// decision. An incomplete or incomparable run writes no RESULT (--allow-nonformal: a non-formal diagnostic without any
// before / after).
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), c26aPath = option('--c26a-result'), a9Path = option('--a9-result'), outputPath = option('--output')
if (!runPath || !c26aPath || !a9Path || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c26a10.mjs --run <raw.json.local> --c26a-result docs/PLANNER_GLOBAL_PHASE2C26A_RESULT.json --a9-result docs/PLANNER_GLOBAL_PHASE2C26A9_RESULT.json --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const allowNonformal = args.includes('--allow-nonformal')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c26aResult = await load(c26aPath), a9Result = await load(a9Path)
const r = run.json

// The calculation code (module, runner and everything they load) must be the measured HEAD; only the post-hoc files below
// may change after the measurement.
const measuredHead = r.environment.repositoryHead
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c26a10.mjs', 'src/benchmarks/plannerGlobalPhase2C26A10Analysis.ts', '*.test.ts']
const CODE_PATHS = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', ...CODE_PATHS).split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0 && !allowNonformal) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)
const analysisCodeUncommitted = Boolean(git('status', '--porcelain', '--', 'src', 'scripts'))
const c26aMeasuredHead = c26aResult.json.provenance?.measuredHead
// "C2.6-A measured Production -> current Production" spans every Production change in between (A6, A9, ...), listed here.
const PRODUCTION_PATHS = ['src/domain', 'src/services', 'src/workers', 'src/db', 'src/pages', 'src/components', 'src/data']
const productionChangedSinceC26aMeasuredHead = typeof c26aMeasuredHead === 'string'
  ? git('diff', '--name-only', c26aMeasuredHead, measuredHead, '--', ...PRODUCTION_PATHS).split(/\r?\n/).filter(Boolean).filter(path => !/\.test\.tsx?$/.test(path)) : null
// The first-parent (main) commits since the C2.6-A branch point: the squash commit that merged C2.6-A and every one after it.
const commitsSinceC26aMeasuredHead = typeof c26aMeasuredHead === 'string'
  ? git('log', '--first-parent', '--format=%h %s', `${git('merge-base', c26aMeasuredHead, measuredHead)}..${measuredHead}`).split(/\r?\n/).filter(Boolean) : null

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const a10 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A10.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A10Analysis.ts')
  const c2 = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C2.ts')
  const c25a = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25AAnalysis.ts')

  // 1. The C2.6-A RESULT as the before authority.
  const beforeParse = analysis.parsePhase2C26A10Before(c26aResult.json)
  if (!beforeParse.valid) throw new Error(`The C2.6-A RESULT is not the registered before authority: ${beforeParse.issues.join('; ')}`)
  const before = beforeParse.before

  // 2. The A9 RESULT authority chain (A9 formal, Case O, made against exactly the C2.6-A and A2 .. A8 files read).
  const chainFiles = a10.phase2c26a10A9ChainFiles(a9Result.json)
  if (chainFiles === null) throw new Error('The A9 RESULT does not name its chain files.')
  const chainSources = {}, chainSha = {}
  for (const [key, file] of Object.entries(chainFiles)) {
    const loaded = await load(join(dirname(a9Path), file))
    chainSources[key] = loaded.source
    chainSha[key] = loaded.source.sha256
  }
  const a9Parse = a10.parsePhase2C26A9ResultAuthority(a9Result.json, { c26a: c26aResult.source.sha256, chain: chainSha }, before.authority)
  if (!a9Parse.valid) throw new Error(`The A9 RESULT is not the registered authority chain: ${a9Parse.issues.join('; ')}`)
  const a9 = a9Parse.authority
  // The authority measured HEADs are PR-branch commits (squash merges): they must exist, and their ancestry is recorded only.
  const commitExists = commit => { try { return execFileSync('git', ['cat-file', '-t', commit], { encoding: 'utf8' }).trim() === 'commit' } catch { return false } }
  const isAncestor = commit => { try { execFileSync('git', ['merge-base', '--is-ancestor', commit, measuredHead]); return true } catch { return false } }
  const ancestry = { c26aMeasuredHeadExists: commitExists(before.authority.measuredHead), a9MeasuredHeadExists: commitExists(a9.measuredHead),
    c26aMeasuredHeadIsAncestor: isAncestor(before.authority.measuredHead), a9MeasuredHeadIsAncestor: isAncestor(a9.measuredHead),
    note: 'PRs are squash-merged: an authority measured HEAD is a PR-branch commit and is not expected to be an ancestor of the A10 measured HEAD.' }
  if ((!ancestry.c26aMeasuredHeadExists || !ancestry.a9MeasuredHeadExists) && !allowNonformal) throw new Error(`An authority measured HEAD is not a commit of this repository: ${JSON.stringify(ancestry)}`)

  // 3. The raw run must be a complete formal A10 series.
  const expectations = { childHeapLimitMb: a10.PHASE2C26A10_CHILD_HEAP_MB, concurrency: a10.PHASE2C26A10_CONCURRENCY,
    orientationBudgetMs: a10.PHASE2C26A10_ORIENTATION_BUDGET_MS, conditions: c2.phase2c2ProductionDefaultConditions() }
  const formalRunValidation = analysis.validatePhase2C26A10FormalRun(r, expectations, { c26a: c26aResult.source.sha256, a9: a9Result.source.sha256, chain: chainSha })
  if (!formalRunValidation.valid && !allowNonformal) throw new Error(`Formal A10 run is incomplete: ${formalRunValidation.failures.join('; ')}`)

  // 4. The same measurement as C2.6-A (baseline, ordered orientations with their Conflict / Entry metadata, every condition).
  const comparability = analysis.validatePhase2C26A10Comparability(r, before)
  if (!comparability.valid && !allowNonformal) throw new Error(`The C2.6-A RESULT is not comparable with this run: ${comparability.issues.join('; ')}`)
  const comparable = comparability.valid

  // 5. Aggregation; the before / after and the decision only for a comparable run.
  const baseline = r.baseline.record
  const orientations = baseline.orientations
  const kernels = r.kernels
  const summary = (await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26AAnalysis.ts')).summarizePhase2C26AKernels(kernels)
  const comparison = comparable ? analysis.comparePhase2C26A10WithC26A(comparability, before, kernels, orientations, sha, a9.primaries) : null
  // The pre-registered decision exists only for a complete formal series (a smoke / subset is a diagnostic, never a case).
  const decision = comparison === null || !formalRunValidation.valid ? null : analysis.phase2c26a10Decision({ orientations: kernels.length, childStatus: summary.childStatus,
    beforeTimeout: before.timeoutOrientationIds.length, comparabilityValid: comparable, beforeCompletedRegressions: comparison.beforeCompletedRegressions.map(row => row.orientationId),
    semanticMismatches: comparison.semanticMismatches, preparationFailedNew: comparison.preparationFailedNew })
  const conclusion = decision === null ? null
    : analysis.phase2c26a10Conclusion(decision, { orientations: kernels.length, childStatus: summary.childStatus, beforeChildStatus: before.childStatus })
  const perOrientation = kernels.map(kernel => analysis.compactPhase2C26A10Kernel(kernel, comparable ? before.view.rows.get(kernel.orientationId) ?? null : null, sha,
    kernel.process.outcome === 'out_of_memory' ? c25a.parsePhase2C25AV8FatalGcTrace(kernel.process.stderrTail) : null))
  const failures = perOrientation.filter(row => row.child.outcome !== 'completed')
    .map(row => ({ orientationId: row.orientationId, kind: row.kind, fixedTargetWeaponId: row.fixedTargetWeaponId, outcome: row.child.outcome, wallMs: row.child.wallMs,
      lastIpcYields: row.child.lastIpcYields, memory: row.memory, v8FatalGc: row.v8FatalGc, stderrTail: row.child.stderrTail, before: row.before?.outcome ?? null,
      targetOutcomeProgress: 'not observable: no observer is attached in A10 and the child wrote no record' }))
  const formal = formalRunValidation.valid && comparable && calculationCodeChangedSinceMeasuredHead.length === 0 && ancestry.c26aMeasuredHeadExists && ancestry.a9MeasuredHeadExists

  const evidence = {
    phase: 'Issue #154 Phase 2-C2.6-A10: whole-orientation-set kernel availability re-evaluation of the current Production (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c26aResult: c26aResult.source, a9Result: a9Result.source, a9Chain: chainSources },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), analysisCodeUncommitted, codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead,
      postHocAllowedFiles: POST_HOC_ALLOWED, formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      authoritySha256: { c26aResult: c26aResult.source.sha256, a9Result: a9Result.source.sha256, a9Chain: chainSha },
      c26aResultSha256: c26aResult.source.sha256, c26aResultRecordedByRunner: r.environment.c26aResultSha256, c26aMeasuredHead: before.authority.measuredHead,
      a9ResultSha256: a9Result.source.sha256, a9ResultRecordedByRunner: r.environment.a9ResultSha256, a9MeasuredHead: a9.measuredHead, a9AnalysisHead: a9.analysisHead,
      a9DecisionCase: a9.decisionCase, ancestry,
      currentProductionScope: { note: 'C2.6-A measured HEAD -> A10 measured HEAD: the before / after is the current Production as a whole, never A9 alone.',
        productionChangedSinceC26aMeasuredHead, commitsSinceC26aMeasuredHead },
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    conditions: {
      childHeapLimitMb: r.environment.childHeapLimitMb, nodeFlags: r.environment.nodeFlags, concurrency: r.environment.concurrency, freshChildPerTask: true,
      orientationBudgetMs: r.environment.orientationBudgetMs, baselineBudgetMs: r.environment.baselineBudgetMs, memorySampleIntervalMs: r.environment.memorySampleIntervalMs,
      nodeYield: r.environment.nodeYield, retry: r.environment.retry, notAttached: r.environment.notAttached, extent: r.conditions.extent, bounds: r.conditions.bounds,
      captureBoundNote: 'The reused Phase 2-C2 conditions object carries captureBound, which only the (not run) portfolio Search reads; the kernel never reads it.',
      lineage: { priorFixedBuildListEntryIds: [], priorExcludedRoutes: [] },
      calculationContext: r.baseline.calculationContext, researchMaxPlanSteps: r.baseline.researchMaxPlanSteps, rngEngineVersion: r.environment.rngEngineVersion,
      notRun: ['portfolio Search', 'global assignment', '1,657-step oracle coverage', 'capture bound change', 'extent extension', '60-minute budget', 'global route redesign', 'new Production optimization', 'CPU profiler'],
      memoryValues: 'process.memoryUsage() sampled maxima (250 ms), never a true peak; a failed child reports its last IPC sample before death',
    },
    baseline: { summary: baseline.summary, orientations: orientations.length, process: { outcome: r.baseline.process.outcome, wallMs: r.baseline.process.wallMs }, memory: r.baseline.memory },
    orientations,
    authorities: {
      c26a: { measuredHead: before.authority.measuredHead, childStatus: before.childStatus, timeoutOrientationIds: before.timeoutOrientationIds, completed: before.completedOrientationIds.length,
        participants: before.participants },
      a9: { measuredHead: a9.measuredHead, decisionCase: a9.decisionCase, concurrency: a9.concurrency, cpuProfiler: a9.cpuProfiler, primaries: a9.primaries,
        note: 'A9 is the authority for the A9-only local effect (concurrency 1, profiler attached). It selects nothing here.' },
    },
    formalRunValidation: { validator: 'validatePhase2C26A10FormalRun (post-hoc, src/benchmarks/plannerGlobalPhase2C26A10Analysis.ts)', ...formalRunValidation },
    comparability: { validator: 'validatePhase2C26A10Comparability (post-hoc); every before / after below exists only when valid. In c26aStyle issue text, "Phase 2-C2" names the reused validator\'s old side, which here is the C2.6-A RESULT.',
      ...comparability },
    decisionRule: analysis.PHASE2C26A10_DECISION_RULE,
    kernel: summary,
    transitions: comparison?.transitions ?? null,
    beforeCompletedRegressions: comparison?.beforeCompletedRegressions ?? null,
    semantics: comparison === null ? null : { core: comparison.coreSemantics, extended: comparison.extendedSemantics, mismatches: comparison.semanticMismatches, preparationFailedNew: comparison.preparationFailedNew },
    oldTimeouts: comparison?.oldTimeouts ?? null,
    participants: comparison?.participants ?? null,
    trialRejectionBeforeAfter: comparison?.trialRejectionBeforeAfter ?? null,
    targetOutcomeBeforeAfter: comparison?.targetOutcomeBeforeAfter ?? null,
    trialsBeforeAfter: comparison?.trialsBeforeAfter ?? null,
    plannerRerunsBeforeAfter: comparison?.plannerRerunsBeforeAfter ?? null,
    foundBeforeAfter: comparison?.foundBeforeAfter ?? null,
    runtime: comparison?.runtime ?? null,
    wallMemoryBeforeAfter: comparison?.wallMemoryBeforeAfter ?? null,
    failures,
    perOrientation,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, exitCode: p.exitCode, signal: p.signal, timedOut: p.timedOut, budgetMs: p.budgetMs, wallMs: p.wallMs, killedAtMs: p.killedAtMs, startedAt: p.startedAt })),
    decision,
    conclusion,
    limitations: [
      'Node child (Vite SSR loader) only; no Browser Worker, no other device / heap / concurrency condition was measured.',
      'One formal series; run-to-run wall-time variance was not measured. concurrency 3 includes mutual interference of the three children.',
      'The C2.6-A -> current difference is the current Production as a whole (A6, A9 and everything in between), never A9 alone.',
      'Memory values are sampled maxima (250 ms), never a true peak; a failed child reports only its last IPC sample before death.',
      'A timeout child wrote no record and no observer is attached: its per-Target progress is not observable and is never read as "no Candidate".',
      'found means only "selected in a kernel trial against that orientation’s fixed Route set"; it is not a completed Plan, a resolved Conflict set, a global assignment or oracle coverage.',
      'A9 primary outcomes are a reference under their own conditions (concurrency 1, CPU profiler); wall times are not directly comparable.',
    ],
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formal, formalRunValidation: formalRunValidation.valid, comparability: { valid: comparability.valid, issues: comparability.issues },
    childStatus: summary.childStatus, transitions: comparison?.transitions.matrix ?? null, semantics: comparison === null ? null : { core: comparison.coreSemantics, extendedDiffering: comparison.extendedSemantics.differing.length },
    participants: comparison === null ? null : { total: comparison.participants.participantsTotal, searched: comparison.participants.participantsSearched, notSearched: comparison.participants.participantsNotSearched },
    decision: decision?.case ?? null }, null, 2))
} finally {
  await server.close()
}
