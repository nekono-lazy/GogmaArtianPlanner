// Issue #260 PR-5A: the Node reference of the Production Build List optimization Browser measurement (benchmark only). At the
// measurement HEAD it runs, once, the very Production calculation the Browser runs - the Production Worker adapter
// (createBuildListOptimizationCalculation(bounds)) with the Production dependencies (ProductionRngEngine, the Production ID factory and
// Clock) - over the input the Browser harness prepares (prepareBloBenchmarkInput(): the Import authorities and the ordinary
// createPlannerInput()), with the complete bounds of one plan bounds set, and records the result's semantic fingerprints
// (bloSemanticFingerprint()) for the analysis to compare with the Browser runs. Plan IDs, Step IDs and times differ by design.
//
//   node scripts/run-build-list-optimization-node-reference.mjs --measurement-head <40 hex> --plan <docs/...md> --input-id <id> --bounds-id <id>
//     [--export <file>] [--preflight-only] --output <new .json>
//
// --preflight-only prepares the input and records its preparation (counts, refusal) without any calculation. The plan, the input
// identity and the bounds come from the measured commit; a different Export, a dirty checkout or another HEAD is refused.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const SCRIPT_PATH = 'scripts/run-build-list-optimization-node-reference.mjs'
const PLAN_DOCS = ['docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md', 'docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md']
const USAGE = `Usage: node ${SCRIPT_PATH} --measurement-head <40 hex> --plan <docs/...md> --input-id <id> --bounds-id <id> [--export <file>] [--preflight-only] --output <new .json>`
const KNOWN = new Set(['--measurement-head', '--plan', '--input-id', '--bounds-id', '--export', '--preflight-only', '--output'])
const args = process.argv.slice(2)
for (const flag of args.filter(value => value.startsWith('--'))) if (!KNOWN.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const head = option('--measurement-head'), planPath = option('--plan'), inputId = option('--input-id'), boundsId = option('--bounds-id'), exportPath = option('--export'), output = option('--output')
const preflightOnly = args.includes('--preflight-only')
if (!/^[0-9a-f]{40}$/.test(head ?? '') || !PLAN_DOCS.includes(planPath) || !inputId || !boundsId || !output) throw new Error(USAGE)

const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = (...values) => execFileSync('git', values, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
if (git('rev-parse', 'HEAD') !== head) throw new Error(`The checkout is not at the measurement HEAD ${head}.`)
if (git('status', '--porcelain', '--', 'src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.benchmark.config.ts') !== '') throw new Error('The measured code has uncommitted changes.')
const planText = execFileSync('git', ['show', `${head}:${planPath}`], { maxBuffer: 1 << 28 })

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
try {
  const load = path => server.ssrLoadModule(path)
  const planModule = await load('/src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkPlan.ts')
  const inputModule = await load('/src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkInput.ts')
  const semanticModule = await load('/src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkSemantic.ts')
  const syntheticModule = await load('/src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkSynthetic.ts')
  const adapter = await load('/src/workers/buildListOptimization.worker.production.ts')
  const { loadMasterData } = await load('/src/domain/master/loadMasterData.ts')

  const extracted = planModule.extractBloMeasurementPlan(planText.toString('utf8'))
  const planIssues = extracted.issues.length > 0 ? extracted.issues : planModule.bloMeasurementPlanIssues(extracted.plan)
  if (planIssues.length > 0) throw new Error(`The plan at ${head}:${planPath} is invalid: ${planIssues.join(' / ')}`)
  const plan = extracted.plan
  const input = plan.inputs.find(entry => entry.inputId === inputId)
  const boundsSet = plan.boundsSets.find(entry => entry.boundsId === boundsId)
  if (input === undefined || boundsSet === undefined) throw new Error(`The plan has no input ${inputId} or bounds set ${boundsId}.`)
  if (!(plan.nodeReference?.runs ?? []).some(run => run.inputId === inputId && run.boundsId === boundsId) && !preflightOnly) {
    throw new Error(`The plan registers no Node reference run for ${inputId} / ${boundsId}.`)
  }

  let text, inputIdentity
  if (input.kind === 'export') {
    if (exportPath === undefined) throw new Error(`--export is required for the Export input ${inputId}.`)
    const bytes = await readFile(exportPath)
    inputIdentity = { kind: 'export', fileName: input.fileName, caseId: null, bytes: bytes.length, sha256: sha256(bytes) }
    if (inputIdentity.bytes !== input.bytes || inputIdentity.sha256 !== input.sha256) throw new Error('The Export is not the plan\'s input (bytes or SHA-256 differ).')
    text = bytes.toString('utf8')
  } else {
    if (exportPath !== undefined) throw new Error('A synthetic input takes no --export.')
    text = syntheticModule.bloSyntheticExportText(input.caseId)
    inputIdentity = { kind: 'synthetic', fileName: null, caseId: input.caseId, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text, 'utf8')) }
  }
  const loaded = loadMasterData()
  if (!loaded.ok) throw new Error('The Master Data does not load.')
  const prepared = await inputModule.prepareBloBenchmarkInput(text, loaded.data, () => performance.now())
  const record = {
    kind: 'build-list-optimization-node-reference', revision: 1, measurementHead: head, plan: { path: planPath, sha256: sha256(planText) },
    inputId, boundsId, inputIdentity, bounds: boundsSet.bounds, node: { version: process.version, platform: `${process.platform} ${process.arch}` },
    preparation: prepared.preparation,
    outcome: { status: 'not_run', failure: null, refusal: prepared.status === 'refused' ? prepared.preparation.refusal.code : null },
    resultStatus: null, semantic: null, elapsedMs: null,
  }
  if (prepared.status === 'ready' && !preflightOnly) {
    const calculation = adapter.createBuildListOptimizationCalculation(boundsSet.bounds)
    const started = performance.now()
    try {
      const run = await calculation(prepared.plannerInput, adapter.createProductionBuildListOptimizationWorkerDependencies(), { now: () => performance.now() })
      record.elapsedMs = Math.round(performance.now() - started)
      if (run.kind !== 'result') throw new Error('The calculation reported a cancellation no one requested.')
      record.outcome = { status: 'completed', failure: null, refusal: null }
      record.resultStatus = run.result.status
      record.semantic = await semanticModule.bloSemanticFingerprint(run.result, async value => sha256(Buffer.from(value, 'utf8')))
    } catch (error) {
      record.elapsedMs = Math.round(performance.now() - started)
      record.outcome = { status: 'failed', failure: `${error?.name ?? 'Error'}: ${error?.code ?? ''}`.trim(), refusal: null }
    }
  }
  const textOut = JSON.stringify(record, null, 2) + '\n'
  await writeFile(output, textOut, { flag: 'wx' })
  console.log(JSON.stringify({ written: output, sha256: sha256(textOut), preparation: record.preparation.status, outcome: record.outcome, resultStatus: record.resultStatus, semantic: record.semantic?.sha256 ?? null, elapsedMs: record.elapsedMs }, null, 2))
} finally {
  await server.close()
}
