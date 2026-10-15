// Issue #260 PR-5A: the post-hoc analysis of the Production Build List optimization Browser measurement (benchmark only). It reads
// the committed plan from the measured commit (git show <measurement HEAD>:<plan document>; a plan edited after the measurement is
// never used), the page's raw record exports, the driver record and the Node reference records, and derives the public RESULT with
// deriveBloPublicResult() (src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkAnalysis.ts).
//
// It reads no Export, runs no calculation, passes nothing back to a run, and refuses to analyze with code other than the measured
// code (the analysis rules are the measured commit's). Every Browser record must carry the benchmark build of the measurement HEAD.
//
//   node scripts/analyze-build-list-optimization-browser.mjs --measurement-head <40 hex> --plan <docs/...md> --validate-plan
//   node scripts/analyze-build-list-optimization-browser.mjs --measurement-head <40 hex> --plan <docs/...md> --browser-raw-dir <dir>
//     [--driver-record <file>] [--node-reference-dir <dir>] (--public <new .json> | --check <.json>)
//
// --validate-plan checks the plan at the measured commit and writes nothing. --public writes exclusively and only a RESULT that
// passes its own checks; --check re-derives and compares.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createServer } from 'vite'

const SCRIPT_PATH = 'scripts/analyze-build-list-optimization-browser.mjs'
/** The plan documents an analysis may read (from the measured commit). */
const PLAN_DOCS = ['docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md', 'docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md']
/** The paths whose content is the analyzed and measured code (the benchmark build's code paths): it must be the measured commit's. */
const CODE_PATHS = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.benchmark.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
  'benchmark.html', 'benchmark-global-assignment.html', 'benchmark-build-list-optimization.html']
const USAGE = `Usage: node ${SCRIPT_PATH} --measurement-head <40 hex> --plan <${PLAN_DOCS.join(' | ')}> (--validate-plan | --browser-raw-dir <dir> [--driver-record <file>] [--node-reference-dir <dir>] (--public <new .json> | --check <.json>))`
const KNOWN_OPTIONS = new Set(['--measurement-head', '--plan', '--validate-plan', '--browser-raw-dir', '--driver-record', '--node-reference-dir', '--public', '--check'])
const VALUE_OPTIONS = new Set([...KNOWN_OPTIONS].filter(name => name !== '--validate-plan'))

const args = process.argv.slice(2)
const flags = args.filter(value => value.startsWith('--'))
for (const flag of flags) if (!KNOWN_OPTIONS.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
if (new Set(flags).size !== flags.length) throw new Error(`Duplicate option; specify each once. ${USAGE}`)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
for (const flag of flags) if (VALUE_OPTIONS.has(flag) && (option(flag) === undefined || option(flag).startsWith('--'))) throw new Error(`${flag} needs a value. ${USAGE}`)
const head = option('--measurement-head')
if (head === undefined || !/^[0-9a-f]{40}$/.test(head)) throw new Error(`--measurement-head must be a 40 lower-case hex commit. ${USAGE}`)
const planPath = option('--plan')
if (!PLAN_DOCS.includes(planPath)) throw new Error(`--plan must be one of ${PLAN_DOCS.join(', ')}. ${USAGE}`)
const validateOnly = args.includes('--validate-plan')
const rawDir = option('--browser-raw-dir'), driverPath = option('--driver-record'), nodeDir = option('--node-reference-dir')
const publicPath = option('--public'), checkPath = option('--check')
if (validateOnly) {
  if (rawDir !== undefined || driverPath !== undefined || nodeDir !== undefined || publicPath !== undefined || checkPath !== undefined) throw new Error(`--validate-plan takes no other input. ${USAGE}`)
} else if (rawDir === undefined || (publicPath === undefined) === (checkPath === undefined)) {
  throw new Error(USAGE)
}

const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = (...values) => execFileSync('git', values, { encoding: 'buffer', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
const gitText = (...values) => git(...values).toString('utf8').trim()

// The measurement HEAD is a commit of this Repository, and the analyzed code is exactly its code.
let resolved = null
try {
  resolved = gitText('rev-parse', '--verify', '--quiet', `${head}^{commit}`)
} catch {
  resolved = null
}
if (resolved !== head) throw new Error(`The measurement HEAD ${head} is not a commit of this Repository.`)
let codeDiffers = true
try {
  execFileSync('git', ['diff', '--quiet', head, '--', ...CODE_PATHS], { stdio: 'ignore' })
  codeDiffers = gitText('ls-files', '--others', '--exclude-standard', '--', ...CODE_PATHS) !== ''
} catch {
  codeDiffers = true
}
if (codeDiffers) throw new Error(`The analyzed code is not the code of the measurement HEAD ${head} (check out that code before analyzing: the analysis rules are the measured commit's).`)

/** A file of the measured commit (`git show <head>:<path>`), hashed over its bytes. */
const atHead = path => {
  const bytes = git('show', `${head}:${path}`)
  return { file: `${head}:${path}`, bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('utf8') }
}
const readSource = async path => {
  const bytes = await readFile(path)
  return { file: basename(path), bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('utf8') }
}
const readDir = async dir => {
  if (dir === undefined) return []
  const names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort()
  const files = []
  for (const name of names) files.push(await readSource(join(dir, name)))
  return files
}

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
let analysis, planModule
try {
  analysis = await server.ssrLoadModule('/src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkAnalysis.ts')
  planModule = await server.ssrLoadModule('/src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkPlan.ts')
} finally {
  await server.close()
}

const plan = atHead(planPath)
if (validateOnly) {
  const extracted = planModule.extractBloMeasurementPlan(plan.text)
  const issues = extracted.issues.length > 0 ? extracted.issues : planModule.bloMeasurementPlanIssues(extracted.plan)
  const value = extracted.plan
  console.log(JSON.stringify({
    plan: plan.file, planSha256: plan.sha256, ok: issues.length === 0, issues,
    summary: issues.length > 0 ? null : {
      planKind: value.planKind, series: value.series, status: value.status, approval: value.approval.state, criteria: value.criteria.status,
      inputs: value.inputs.map(input => `${input.inputId}:${input.kind}`), boundsSets: value.boundsSets.map(set => `${set.boundsId}:${set.role}`),
      environments: value.environments.map(environment => ({ environmentId: environment.environmentId, status: environment.status, slots: environment.slots.length })),
    },
  }, null, 2))
  process.exitCode = issues.length === 0 ? 0 : 1
} else {
  const browserRaw = await readDir(rawDir)
  if (browserRaw.length === 0) throw new Error(`No Browser raw file (*.json) in ${rawDir}.`)
  const sources = { measurementHead: head, plan, browserRaw, driver: driverPath === undefined ? null : await readSource(driverPath), nodeReferences: await readDir(nodeDir) }
  if (publicPath !== undefined) {
    const derived = analysis.deriveBloPublicResult(sources)
    const issues = derived.ok ? analysis.bloPublicResultIssues(derived.result, sources) : derived.issues
    if (issues.length > 0) {
      console.error(JSON.stringify({ written: false, issues }, null, 2))
      process.exit(1)
    }
    const text = JSON.stringify(derived.result, null, 2) + '\n'
    await writeFile(publicPath, text, { flag: 'wx' })
    console.log(JSON.stringify({ written: publicPath, bytes: Buffer.byteLength(text), sha256: sha256(text), verdicts: derived.result.verdicts, missingSlots: derived.result.binding.missingSlots, unplanned: derived.result.binding.unplanned.length }, null, 2))
  } else {
    const text = await readFile(checkPath, 'utf8')
    const published = JSON.parse(text)
    const issues = analysis.bloPublicResultIssues(published, sources)
    if (text !== JSON.stringify(published, null, 2) + '\n') issues.push('The public RESULT is not in the canonical serialization (JSON.stringify(value, null, 2) + newline).')
    console.log(JSON.stringify({ checked: checkPath, sha256: sha256(text), ok: issues.length === 0, issues }, null, 2))
    if (issues.length > 0) process.exitCode = 1
  }
}
