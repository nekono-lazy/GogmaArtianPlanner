// Issue #154 Phase 2-C2.5-D2-d: post-hoc analysis of one raw run of run-planner-global-phase2c25d2d.mjs.
// Reads the raw run, the D2-a RESULT (the "before" values), the D2-c RESULT (the profiled reference), the C2.5-A evidence
// (provenance only), the semantic test report of the measured HEAD (a Vitest JSON report) and writes the committed
// evidence JSON. Runs no Planner and no Search. The written interpretation is the committed
// src/benchmarks/plannerGlobalPhase2C25D2DInterpretation.ts (post-hoc, allowlisted).
// Before any analysis, validatePhase2C25D2DFormalRun() (src/benchmarks/plannerGlobalPhase2C25D2DFormalValidation.ts,
// post-hoc, allowlisted, imported by no runner) must prove the run is a complete series: every context of the workload
// re-derived here exactly once, both modes each, nothing foreign. An incomplete run writes no RESULT.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), c25aPath = option('--c25a'), d2aPath = option('--d2a'), d2cPath = option('--d2c'), testsPath = option('--semantic-tests'),
  testsHead = option('--semantic-tests-head'), outputPath = option('--output')
if (!runPath || !c25aPath || !d2aPath || !d2cPath || !testsPath || !testsHead || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c25d2d.mjs --run <raw.json.local> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --d2a docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json --d2c docs/PLANNER_GLOBAL_PHASE2C25D2C_RESULT.json --semantic-tests <vitest.json.local> --semantic-tests-head <sha> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c25a = await load(c25aPath), d2a = await load(d2aPath), d2c = await load(d2cPath), tests = await load(testsPath)
const r = run.json
if (r.status !== 'completed') throw new Error(`The raw run did not complete its Search runs (status ${r.status}).`)
if (r.environment.c25aEvidenceSha256 !== c25a.source.sha256 || r.environment.d2aResultSha256 !== d2a.source.sha256 || r.environment.d2cResultSha256 !== d2c.source.sha256) {
  throw new Error('The raw run was selected from other C2.5-A / D2-a / D2-c evidence files.')
}
const formal = r.environment.uncommittedBenchmarkCode === false && r.environment.smoke === null
if (!formal && !args.includes('--allow-nonformal')) throw new Error('The raw run is not formal (uncommitted code or smoke options).')

// The calculation code (modules, runners and everything they load) must be the measured HEAD; only the post-hoc files
// below may change after the measurement.
const measuredHead = r.environment.repositoryHead
// Post-hoc only: the analyzer, the written interpretation and the formal completeness validator (which decides whether a
// raw run may become formal evidence; no runner, Search or benchmark calculation imports it), plus tests.
const POST_HOC_ALLOWED = ['scripts/analyze-planner-global-phase2c25d2d.mjs', 'src/benchmarks/plannerGlobalPhase2C25D2DInterpretation.ts',
  'src/benchmarks/plannerGlobalPhase2C25D2DFormalValidation.ts', '*.test.ts']
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => POST_HOC_ALLOWED.includes(path) || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)

// The semantic test report must come from the measured HEAD and have no failure.
if (testsHead !== measuredHead) throw new Error('The semantic test report was not produced at the measured HEAD.')
const report = tests.json
const testFiles = report.testResults.map(file => ({ file: file.name.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/'), status: file.status,
  passed: file.assertionResults.filter(a => a.status === 'passed').length, failed: file.assertionResults.filter(a => a.status === 'failed').length }))
const KEY_TESTS = /(reservedBonusStreamSinglePass|plannerAlternativeIdeal(Publication|OnlyPublication)|plannerAlternativeReservation|plannerAlternativeFrontier|plannerAlternativeSearch|lazyIdealCross|candidateSearch\.integration|incrementalSearch|normalRouteReduction|plannerGlobalPhase2C25D2D)\.test\.ts$/
const semanticTests = { reportHead: testsHead, numTotalTests: report.numTotalTests, numPassedTests: report.numPassedTests, numFailedTests: report.numFailedTests,
  numTotalTestSuites: report.numTotalTestSuites, success: report.success, keyFiles: testFiles.filter(file => KEY_TESTS.test(file.file)) }
if (!report.success || report.numFailedTests !== 0) throw new Error('The semantic test report has failures.')
if (!semanticTests.keyFiles.some(file => file.file.endsWith('reservedBonusStreamSinglePass.test.ts')) || !semanticTests.keyFiles.some(file => file.file.endsWith('plannerAlternativeIdealPublication.test.ts'))) {
  throw new Error('The semantic test report lacks the single-pass or the PR #173 baseline test file.')
}

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const d2d = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25D2D.ts')
  const d2cModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25D2C.ts')
  const c25c = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25C.ts')
  const formalValidation = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25D2DFormalValidation.ts')
  // The expected workload, re-derived here from the committed evidence (the runner's own rule), never read from the raw run.
  const expectedWorkload = d2cModule.selectPhase2C25D2CWorkload(d2cModule.parsePhase2C25D2CD2AResult(d2a.json),
    c25c.selectPhase2C25CWorkload(c25c.parsePhase2C25CEvidence(c25a.json)))
  d2d.assertPhase2C25D2DWorkloadMatchesD2C(expectedWorkload, d2d.parsePhase2C25D2DD2CResult(d2c.json).items)
  const formalRunValidation = formalValidation.validatePhase2C25D2DFormalRun(d2d.phase2c25d2dWorkloadItems(expectedWorkload), r)
  if (!formalRunValidation.valid && !args.includes('--allow-nonformal')) {
    throw new Error(`Formal D2-d run is incomplete: ${formalRunValidation.failures.join('; ')}`)
  }
  const interpretationPath = '/src/benchmarks/plannerGlobalPhase2C25D2DInterpretation.ts'
  const interpretation = existsSync(`.${interpretationPath}`) ? (await server.ssrLoadModule(interpretationPath)).PHASE2C25D2D_INTERPRETATION : null
  if (interpretation === null && !args.includes('--allow-nonformal')) throw new Error('The interpretation module is missing.')
  const result = d2d.analyzePhase2C25D2DRun(r, d2a.json, d2c.json)
  // H1 structural audit: the measured bonusStream.ts against the one D2-c measured.
  const d2cMeasuredHead = d2c.json.provenance.measuredHead
  const sourceAudit = {
    measured: { head: measuredHead, ...d2d.auditPhase2C25D2DBonusStreamSource(git('show', `${measuredHead}:src/domain/search/bonusStream.ts`)) },
    d2cMeasured: { head: d2cMeasuredHead, ...d2d.auditPhase2C25D2DBonusStreamSource(git('show', `${d2cMeasuredHead}:src/domain/search/bonusStream.ts`)) },
    productionFilesChangedSinceD2CMeasured: git('diff', '--name-only', d2cMeasuredHead, measuredHead, '--', 'src/domain', 'src/services', 'src/workers', 'src/pages', 'src/components')
      .split(/\r?\n/).filter(path => path && !/\.test\.tsx?$/.test(path)),
  }
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.5-D2-d: Node memory / runtime effect of the single-pass held-aware Bonus stream (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c25a: c25a.source, d2a: d2a.source, d2c: d2c.source, semanticTests: tests.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead, postHocAllowedFiles: POST_HOC_ALLOWED,
      formal: formal && formalRunValidation.valid,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c25aEvidenceFileName: r.environment.c25aEvidenceFileName, c25aEvidenceSha256: r.environment.c25aEvidenceSha256,
      d2aResultFileName: r.environment.d2aResultFileName, d2aResultSha256: r.environment.d2aResultSha256, d2aMeasuredHead: r.environment.d2aMeasuredHead,
      d2cResultFileName: r.environment.d2cResultFileName, d2cResultSha256: r.environment.d2cResultSha256, d2cMeasuredHead: r.environment.d2cMeasuredHead,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    conditions: {
      childHeapLimitMb: r.environment.childHeapLimitMb, jit: r.environment.jit, concurrency: r.environment.concurrency, freshChildPerSearchRun: true, childScript: r.environment.childScript,
      modes: r.environment.modes, nodeYield: r.environment.nodeYield, searchExtent: r.environment.searchExtent, candidateStopBound: r.environment.candidateStopBound,
      snapshotPolicy: r.environment.snapshotPolicy, minimalMemoryHeartbeatMs: r.environment.minimalMemoryHeartbeatMs, runBudgetMs: r.environment.runBudgetMs,
      calculationContext: r.environment.calculationContext, researchMaxPlanSteps: r.environment.researchMaxPlanSteps,
      memoryValues: 'process.memoryUsage() periodic samples are sampled maxima, never a true peak; v8FatalGc is V8\'s own trace line at an OOM death; D2-c values come from a profiled child and are a reference only',
    },
    workloadSelection: {
      rule: r.workload.rule,
      primary: r.workload.primary.map(({ expected: _e, ...item }) => item),
      clearedReferences: r.workload.clearedReferences.map(({ expected: _e, ...item }) => item),
      controls: r.workload.controls.map(({ expected: _e, ...item }) => item),
      unselected: r.workload.unselected,
      equalsD2CWorkload: true,
    },
    contextParity: { contexts: r.parity.length, matching: r.parity.filter(row => row.matches && row.digestMatches).length, rows: r.parity },
    formalRunValidation: { validator: 'validatePhase2C25D2DFormalRun (post-hoc, src/benchmarks/plannerGlobalPhase2C25D2DFormalValidation.ts)', ...formalRunValidation },
    semanticTests,
    sourceAudit,
    ...result,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, exitCode: p.exitCode, signal: p.signal, timedOut: p.timedOut, budgetMs: p.budgetMs, wallMs: p.wallMs, startedAt: p.startedAt })),
    interpretation,
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, formalRunValidation, totals: result.totals, sourceAudit }, null, 2))
} finally {
  await server.close()
}
