// Issue #154 Phase 2-C2.5-D2-a: post-hoc analysis of one raw run of run-planner-global-phase2c25d2a.mjs.
// Reads the raw run, the Phase 2-C2.5-A evidence (explicit --c25a, the "before" values), the semantic test report of
// the measured HEAD (explicit --semantic-tests, a Vitest JSON report) and the written interpretation (explicit
// --interpretation), and writes the committed evidence JSON. Runs no Planner and no Search.
import { readFile, writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runPath = option('--run'), c25aPath = option('--c25a'), testsPath = option('--semantic-tests'), interpretationPath = option('--interpretation'), outputPath = option('--output')
if (!runPath || !c25aPath || !testsPath || !interpretationPath || !outputPath) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c25d2a.mjs --run <raw.json.local> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json --semantic-tests <vitest.json.local> --interpretation <interpretation.json.local> --output <new.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }
const run = await load(runPath), c25a = await load(c25aPath), tests = await load(testsPath), interpretation = await load(interpretationPath)
const r = run.json
if (r.status !== 'completed') throw new Error(`The raw run did not complete its Search runs (status ${r.status}).`)
if (r.environment.c25aEvidenceSha256 !== c25a.source.sha256) throw new Error('The raw run selected its workload from another Phase 2-C2.5-A evidence file.')
const formal = r.environment.uncommittedBenchmarkCode === false && r.environment.smoke === null
if (!formal && !args.includes('--allow-nonformal')) throw new Error('The raw run is not formal (uncommitted code or smoke options).')

// The calculation code (modules, runner and everything they load) must be the measured HEAD; only this post-hoc
// analyzer, tests and documents may change after the measurement.
const measuredHead = r.environment.repositoryHead
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts').split(/\r?\n/).filter(Boolean)
const postHocOnly = path => path === 'scripts/analyze-planner-global-phase2c25d2a.mjs' || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0) throw new Error(`Calculation code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)

// The semantic test report must come from the measured HEAD and have no failure.
const report = tests.json
const testFiles = report.testResults.map(file => ({ file: file.name.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/'), status: file.status,
  passed: file.assertionResults.filter(a => a.status === 'passed').length, failed: file.assertionResults.filter(a => a.status === 'failed').length }))
const semanticTests = { reportHead: interpretation.json.semanticTestsHead, numTotalTests: report.numTotalTests, numPassedTests: report.numPassedTests, numFailedTests: report.numFailedTests,
  numTotalTestSuites: report.numTotalTestSuites, success: report.success, keyFiles: testFiles.filter(file => /plannerAlternativeIdeal(Publication|OnlyPublication)\.test\.ts$/.test(file.file)) }
if (semanticTests.reportHead !== measuredHead) throw new Error('The semantic test report was not produced at the measured HEAD.')
if (!report.success || report.numFailedTests !== 0) throw new Error('The semantic test report has failures.')

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const d2a = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25D2A.ts')
  const result = d2a.analyzePhase2C25D2ARun(r, c25a.json)
  const evidence = {
    phase: 'Issue #154 Phase 2-C2.5-D2-a: Node memory effect of the Ideal-only Planner Alternative publication (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { run: run.source, c25a: c25a.source, semanticTests: tests.source, interpretation: interpretation.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead, formal,
      benchmarkCodeSha256: r.environment.benchmarkCodeSha256, uncommittedBenchmarkCode: r.environment.uncommittedBenchmarkCode,
      exportFileName: r.environment.exportFileName, exportSha256: r.environment.exportSha256, exportBytes: r.environment.exportBytes,
      c25aEvidenceFileName: r.environment.c25aEvidenceFileName, c25aEvidenceSha256: r.environment.c25aEvidenceSha256, c25aMeasuredHead: r.environment.c25aMeasuredHead,
      measuredAt: r.measuredAt, runWallMs: r.wallMs,
    },
    environment: { runtime: r.environment.runtime, node: r.environment.node, v8: r.environment.v8, platform: r.environment.platform, arch: r.environment.arch,
      osRelease: r.environment.osRelease, cpu: r.environment.cpu, logicalCpuCount: r.environment.logicalCpuCount, totalMemoryBytes: r.environment.totalMemoryBytes },
    conditions: {
      childHeapLimitMb: r.environment.childHeapLimitMb, jit: r.environment.jit, concurrency: r.environment.concurrency, freshChildPerSearchRun: true, modes: r.environment.modes,
      nodeYield: r.environment.nodeYield, searchExtent: r.environment.searchExtent, candidateStopBound: r.environment.candidateStopBound,
      snapshotPolicy: r.environment.snapshotPolicy, minimalMemoryHeartbeatMs: r.environment.minimalMemoryHeartbeatMs, runBudgetMs: r.environment.runBudgetMs,
      calculationContext: r.environment.calculationContext, researchMaxPlanSteps: r.environment.researchMaxPlanSteps,
      memoryValues: 'process.memoryUsage() periodic samples are sampled maxima, never a true peak; v8FatalGc is V8\'s own trace line at an OOM death',
    },
    workloadSelection: {
      rule: r.workload.rule,
      oomRepresentatives: r.workload.oomRepresentatives.map(({ expected: _e, ...item }) => item),
      controls: r.workload.controls.map(({ expected: _e, ...item }) => item),
    },
    contextParity: { contexts: r.parity.length, matching: r.parity.filter(row => row.matches).length, rows: r.parity },
    semanticTests,
    ...result,
    processes: r.processes.map(p => ({ id: p.id, role: p.role, outcome: p.outcome, exitCode: p.exitCode, signal: p.signal, timedOut: p.timedOut, wallMs: p.wallMs, startedAt: p.startedAt })),
    formalConclusions: interpretation.json.formalConclusions,
    notYetClaimable: interpretation.json.notYetClaimable,
    optimizationAttribution: interpretation.json.optimizationAttribution,
    limitations: interpretation.json.limitations,
    nextPhaseRecommendation: interpretation.json.nextPhaseRecommendation,
  }
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, totals: result.totals }, null, 2))
} finally {
  await server.close()
}
