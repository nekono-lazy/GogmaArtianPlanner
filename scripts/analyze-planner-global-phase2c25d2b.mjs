// Issue #154 Phase 2-C2.5-D2-b: post-hoc analysis of one real Chrome measurement run.
//
// Reads the run directory the external CDP driver wrote (the page's verbatim exportJson() of every page session and the
// driver's external evidence), the Phase 2-C2.5-A evidence (workload selection by the D2-a rule, and the check that every
// page session selected from the same file), the Node D2-a result and the Phase 2-C2.5-B results (post-hoc comparison
// only), and writes the three committed files. Runs no Planner and no Search. The page exports are committed as they are
// (wrapped in one list); the external evidence is committed as the driver wrote it. A re-analysis of an already committed
// run never rewrites those two raw files: when they exist, the analyzer only checks that the same run reproduces them
// byte for byte (and fails otherwise), and records that check in the provenance.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const runDir = option('--run-dir'), c25aPath = option('--c25a'), d2aPath = option('--d2a'), c25bPath = option('--c25b')
const outputPath = option('--output'), browserOutput = option('--browser-output'), externalOutput = option('--external-output')
if (!runDir || !c25aPath || !d2aPath || !c25bPath || !outputPath || !browserOutput || !externalOutput) {
  throw new Error('Usage: node scripts/analyze-planner-global-phase2c25d2b.mjs --run-dir <driver out dir> --c25a docs/PLANNER_GLOBAL_PHASE2C25A_RESULT.json '
    + '--d2a docs/PLANNER_GLOBAL_PHASE2C25D2A_RESULT.json --c25b docs/PLANNER_GLOBAL_PHASE2C25B_RESULTS.json '
    + '--output <result.json> --browser-output <browser results.json> --external-output <external memory.json> [--allow-nonformal]')
}
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${outputPath}`)
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const sha = value => createHash('sha256').update(value).digest('hex')
const load = async path => { const raw = await readFile(path); return { raw, json: JSON.parse(raw.toString('utf8')), source: { file: basename(path), bytes: raw.length, sha256: sha(raw) } } }

const c25a = await load(c25aPath)
const d2a = await load(d2aPath)
const c25b = await load(c25bPath)
const external = await load(join(runDir, 'external.json'))
const pageFiles = (await readdir(runDir)).filter(name => /^page-session-\d+\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
const pages = await Promise.all(pageFiles.map(name => load(join(runDir, name))))
if (pages.length === 0) throw new Error('The run directory holds no page export.')
if (external.json.error) throw new Error(`The driver stopped with an error: ${external.json.error}`)
if (!external.json.completedAt) throw new Error('The driver did not complete its series.')

// Formal: every page session ran the same clean committed build, prepared with full context parity, on the same inputs.
const builds = new Set(pages.map(page => JSON.stringify(page.json.environment.benchmarkBuild)))
if (builds.size !== 1) throw new Error('Page sessions ran different benchmark builds.')
const build = pages[0].json.environment.benchmarkBuild
const formal = build !== null && build.uncommittedBenchmarkCode === false && pages.every(page => page.json.preparation?.status === 'ok' && page.json.preparation.parity?.matches === true)
  && external.json.driver.only === null && pages.every(page => page.json.protocolVersion === 'planner-global-phase2c25d2b')
if (!formal && !args.includes('--allow-nonformal')) throw new Error('The run is not formal (uncommitted benchmark code, a failed parity, another protocol or a smoke subset).')
for (const page of pages) {
  if (page.json.evidenceInfo?.sha256 !== c25a.source.sha256) throw new Error('A page session selected its workload from another Phase 2-C2.5-A evidence file.')
}
const measuredHead = build.commit
const changed = git('diff', '--name-only', measuredHead, 'HEAD', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.benchmark.config.ts', 'benchmark.html')
  .split(/\r?\n/).filter(Boolean)
const postHocOnly = path => path === 'src/benchmarks/plannerGlobalPhase2C25D2BAnalysis.ts' || path === 'scripts/analyze-planner-global-phase2c25d2b.mjs' || /\.test\.tsx?$/.test(path)
const calculationCodeChangedSinceMeasuredHead = changed.filter(path => !postHocOnly(path))
if (calculationCodeChangedSinceMeasuredHead.length > 0) throw new Error(`Benchmark code changed since the measured HEAD: ${calculationCodeChangedSinceMeasuredHead.join(', ')}`)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const evidenceModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25BEvidence.ts')
  const workloadModule = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25D2B.ts')
  const analysis = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C25D2BAnalysis.ts')
  const view = evidenceModule.parsePhase2C25BEvidence(c25a.json)
  const workload = workloadModule.phase2c25d2bWorkload(view, c25a.json)
  const node = analysis.parsePhase2C25D2ANodeResult(d2a.json)
  const before = analysis.parsePhase2C25BBrowserBefore(c25b.json)
  const exportSha256 = pages[0].json.exportInfo.sha256
  if (pages.some(page => page.json.exportInfo.sha256 !== exportSha256) || exportSha256 !== view.exportSha256) throw new Error('The Export differs between sessions or from the evidence.')
  if (node.exportSha256 !== exportSha256 || before.exportSha256 !== exportSha256) throw new Error('The Node D2-a or Browser before result measured another Export.')
  if (node.c25aEvidenceSha256 !== c25a.source.sha256 || before.evidenceSha256 !== c25a.source.sha256) throw new Error('The Node D2-a or Browser before result used another Phase 2-C2.5-A evidence.')
  for (const page of pages) {
    if (JSON.stringify(page.json.workload.map(c => [c.orientationId, c.workIndex, c.contextDigest])) !== JSON.stringify(workload.map(c => [c.orientationId, c.workIndex, c.contextDigest]))) {
      throw new Error('A page session ran another workload than the D2-a rule selects.')
    }
  }
  // The pre-registered run set (5 contexts x minimal / instrumented x the Phase 2-C2.5-B repeat rule), fail-closed on the
  // external run set before any result: an incomplete series is never analyzed as formal.
  const formalSeriesValidation = analysis.validatePhase2C25D2BFormalSeries({ workload, external: external.json })
  // Only an explicitly non-formal smoke analysis (--allow-nonformal on a run that is not formal anyway) may continue past it.
  if (!formalSeriesValidation.valid && (formal || !args.includes('--allow-nonformal'))) {
    throw new Error(`Formal series incomplete: ${formalSeriesValidation.issues.join(' / ')}`)
  }
  const result = analysis.analyzePhase2C25D2B({ pages: pages.map(page => page.json), external: external.json, workload, node, before })
  if (formal && result.contexts.some(context => context.classification === 'not_run')) throw new Error('Formal series incomplete: a workload context was not run.')
  const env = pages[0].json.environment
  const workerRealmJsHeapSizeLimit = pages.flatMap(page => page.json.records).find(record => record.workerEnvironment?.performanceMemory)?.workerEnvironment.performanceMemory.jsHeapSizeLimit ?? null
  const heapLimits = { pageRealmJsHeapSizeLimit: env.mainRealmPerformanceMemory?.jsHeapSizeLimit ?? null, workerRealmJsHeapSizeLimit }
  const statements = analysis.phase2c25d2bStatements(result, heapLimits)
  // The raw evidence: written for a new run, only verified byte for byte when it already exists (never rewritten).
  const rawEvidence = {}
  const browserContent = Buffer.from(JSON.stringify({ phase: 'Issue #154 Phase 2-C2.5-D2-b: the page exportJson() of every page session, verbatim',
    sessions: pages.map((page, index) => ({ session: index + 1, source: page.source, export: page.json })) }, null, 1) + '\n')
  for (const [key, path, content] of [['browserResults', browserOutput, browserContent], ['externalMemory', externalOutput, external.raw]]) {
    if (lstatSync(path, { throwIfNoEntry: false }) !== undefined) {
      const existing = await readFile(path)
      if (!existing.equals(content)) throw new Error(`${path} exists and differs from what this run reproduces; raw evidence is never rewritten.`)
      rawEvidence[key] = { file: basename(path), sha256: sha(existing), bytes: existing.length, action: 'verified_unchanged' }
    } else {
      await writeFile(path, content, { flag: 'wx' })
      rawEvidence[key] = { file: basename(path), sha256: sha(content), bytes: content.length, action: 'written' }
    }
  }
  const results = {
    phase: 'Issue #154 Phase 2-C2.5-D2-b: Chrome Dedicated Worker re-measurement after the D2-a Ideal-only publication (post-hoc analysis)',
    analyzedAt: new Date().toISOString(),
    sources: { pages: pages.map(page => page.source), external: external.source, c25aEvidence: c25a.source, d2aResult: d2a.source, c25bResults: c25b.source },
    provenance: {
      measuredHead, analysisHead: git('rev-parse', 'HEAD'), codeChangedSinceMeasuredHead: changed, calculationCodeChangedSinceMeasuredHead, formal,
      benchmarkCodeSha256: build.benchmarkCodeSha256, uncommittedBenchmarkCode: build.uncommittedBenchmarkCode,
      exportFileName: pages[0].json.exportInfo.fileName, exportSha256, exportBytes: pages[0].json.exportInfo.byteSize,
      c25aEvidenceFileName: pages[0].json.evidenceInfo.fileName, c25aEvidenceSha256: c25a.source.sha256, c25aMeasuredHead: view.measuredHead,
      d2aResultSha256: d2a.source.sha256, d2aMeasuredHead: node.measuredHead, c25bResultsSha256: c25b.source.sha256, c25bMeasuredHead: before.measuredHead,
      driverSha256: external.json.driver.sha256, driverBase: external.json.driver.base ?? null, measuredAt: external.json.driver.startedAt, pageSessions: pages.length,
      rawEvidence,
    },
    environment: {
      chrome: external.json.driver.chromeVersion, chromeFlags: external.json.driver.chromeFlags, userAgent: env.userAgent, userAgentData: env.userAgentData,
      hardwareConcurrency: env.hardwareConcurrency, deviceMemory: env.deviceMemory, crossOriginIsolated: env.crossOriginIsolated, isSecureContext: env.isSecureContext,
      visibilityAtSessionStart: pages.map(page => page.json.environment.visibilityState), mainRealmPerformanceMemory: env.mainRealmPerformanceMemory,
      workerPerformanceMemory: pages.flatMap(page => page.json.records)[0]?.workerEnvironment?.performanceMemory ?? null, machine: external.json.machine,
      heapLimits: {
        ...heapLimits,
        workerHeapLimitMeasured: workerRealmJsHeapSizeLimit !== null,
        note: 'The page realm limit is another realm\'s value, given for reference only. The Dedicated Worker used heap is the external CDP sample (runs[].cdp). The Dedicated Worker\'s own limit is unknown unless the Worker realm reported one. Neither is compared with Node.',
      },
      rngEngineVersion: env.rngEngineVersion, calculationAppSchemaVersion: env.calculationAppSchemaVersion,
    },
    conditions: {
      searchExtent: env.searchExtent, candidateStopBound: env.candidateStopBound, snapshotPolicy: env.snapshotPolicy, cdpSampleIntervalMs: external.json.driver.intervalMs,
      runBudgetMs: env.runBudgetMs, driverRunBudgetMs: external.json.driver.runBudgetMs, researchMaxPlanSteps: env.researchMaxPlanSteps, yield: env.yield,
      workerPolicy: env.workerPolicy, modes: ['minimal', 'instrumented'], concurrency: 1,
      repeatPolicy: 'Phase 2-C2.5-B rule, unchanged: a context whose attempt 1 pair had a page / browser crash, a native Worker failure, a mode disagreement or a CDP attach failure is run once more (at most 2 attempts); both attempts are kept',
      classificationPolicy: 'Phase 2-C2.5-B pre-registered rule, unchanged (phase2c25bPairClassification); an explicit V8 OOM crash key is auxiliary only',
    formalSeriesPolicy: 'validatePhase2C25D2BFormalSeries(): every workload context has exactly one attempt 1 minimal / instrumented run; the repeat decision recomputed by phase2c25bRepeatDecision() equals the recorded one; exactly one attempt 2 pair where it repeats and none otherwise; no attempt above 2, foreign context, duplicate run or extra / missing decision; driver modes exactly minimal + instrumented, allowRepeat true, only null, completedAt present. Checked before the analysis; a failure ends the analyzer without a result.',
    },
    parity: pages.map((page, index) => ({ session: index + 1, status: page.json.preparation.status, matches: page.json.preparation.parity.matches,
      rows: page.json.preparation.parity.rows.length, matchingRows: page.json.preparation.parity.rows.filter(row => row.matches).length,
      workloadRows: page.json.preparation.parity.rows.filter(row => workload.some(c => c.orientationId === row.orientationId && c.workIndex === row.workIndex))
        .map(row => ({ orientationId: row.orientationId, workIndex: row.workIndex, matches: row.matches, checks: row.checks })),
      baselineSummary: page.json.preparation.parity.baselineSummary, contextsWorker: page.json.preparation.contextsWorker })),
    workload,
    formalSeriesValidation,
    repeatDecisions: external.json.repeatDecisions ?? [],
    ...result,
    statements,
  }
  await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputPath, totals: result.totals, verdict: result.verdict }, null, 2))
} finally {
  await server.close()
}
