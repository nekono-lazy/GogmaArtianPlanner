// Issue #154 Production準備 P-2 (Research only). The post-hoc analysis of the Browser measurement of the real Export
// (docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_READINESS.md 12 / 16.2). It reads the committed measurement plan and the D-1C public RESULT
// from the measured commit (git show <measurement HEAD>:<path>; a plan edited after the measurement is never used), the Browser raw
// files the external driver saved (the page's exportJson() of each logical run), the driver record, and the Node reference (the D-1A
// non-formal runner's output and its first / fresh records at the same HEAD), and derives the public RESULT with
// deriveGabPublicResult() (src/benchmarks/globalAssignment/browser/globalAssignmentBrowserAnalysis.ts): per environment the semantic
// parity, the cancel trials, the tally of how every slot ended, and the observed timings, responsiveness and memory.
//
// It reads no Export, runs no RNG prediction, Search, Planner or Trace Replay, passes nothing back to a Browser run, and refuses to
// analyze with code other than the measured code (the analysis rules are the measured commit's). The D-1C RESULT path comes from the
// plan, never from this script.
//
//   node scripts/analyze-planner-global-assignment-browser.mjs --measurement-head <40 hex> --validate-plan
//   node scripts/analyze-planner-global-assignment-browser.mjs --measurement-head <40 hex> --browser-raw-dir <dir> [--driver-record <file>]
//     [--node-output <file> --node-run-dir <dir>] (--public <new public .json> | --check <public .json>)
//
// --validate-plan checks the plan at the measured commit (its shape, the D-1C RESULT SHA-256 it fixed, the registered conditions) and
// writes nothing. --public writes exclusively and only a RESULT that passes its own checks; --check re-derives and compares.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createServer } from 'vite'

const SCRIPT_PATH = 'scripts/analyze-planner-global-assignment-browser.mjs'
const PLAN_DOC = 'docs/PLANNER_GLOBAL_ASSIGNMENT_BROWSER_P2_PLAN.md'
/** The paths whose content is the analyzed code (the benchmark build's code paths): it must be the measured commit's. */
const CODE_PATHS = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.benchmark.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'benchmark.html', 'benchmark-global-assignment.html']
const USAGE = `Usage: node ${SCRIPT_PATH} --measurement-head <40 hex> (--validate-plan | --browser-raw-dir <dir> [--driver-record <file>] [--node-output <file> --node-run-dir <dir>] (--public <new .json> | --check <.json>))`
const KNOWN_OPTIONS = new Set(['--measurement-head', '--validate-plan', '--browser-raw-dir', '--driver-record', '--node-output', '--node-run-dir', '--public', '--check'])
const VALUE_OPTIONS = new Set([...KNOWN_OPTIONS].filter(name => name !== '--validate-plan'))

const args = process.argv.slice(2)
const flags = args.filter(value => value.startsWith('--'))
for (const flag of flags) if (!KNOWN_OPTIONS.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
if (new Set(flags).size !== flags.length) throw new Error(`Duplicate option; specify each once. ${USAGE}`)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
for (const flag of flags) if (VALUE_OPTIONS.has(flag) && (option(flag) === undefined || option(flag).startsWith('--'))) throw new Error(`${flag} needs a value. ${USAGE}`)
const has = name => args.includes(name)
const head = option('--measurement-head')
if (head === undefined || !/^[0-9a-f]{40}$/.test(head)) throw new Error(`--measurement-head must be a 40 lower-case hex commit. ${USAGE}`)
const validateOnly = has('--validate-plan')
const rawDir = option('--browser-raw-dir'), driverPath = option('--driver-record'), nodeOutputPath = option('--node-output'), nodeRunDir = option('--node-run-dir')
const publicPath = option('--public'), checkPath = option('--check')
if (validateOnly) {
  if (rawDir !== undefined || driverPath !== undefined || nodeOutputPath !== undefined || nodeRunDir !== undefined || publicPath !== undefined || checkPath !== undefined) throw new Error(`--validate-plan takes no other input. ${USAGE}`)
} else {
  if (rawDir === undefined || (publicPath === undefined) === (checkPath === undefined)) throw new Error(USAGE)
  if ((nodeOutputPath === undefined) !== (nodeRunDir === undefined)) throw new Error(`--node-output and --node-run-dir go together. ${USAGE}`)
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
if (codeDiffers) throw new Error(`The analyzed code is not the code of the measurement HEAD ${head} (commit or check out that code before analyzing: the analysis rules are the measured commit's).`)

/** A file of the measured commit (`git show <head>:<path>`), hashed over its bytes. */
const atHead = path => {
  const bytes = git('show', `${head}:${path}`)
  return { file: `${head}:${path}`, bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('utf8'), commit: head, path }
}
const readSource = async path => {
  const bytes = await readFile(path)
  return { file: basename(path), bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('utf8') }
}

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
let analysis, planModule, registration
try {
  analysis = await server.ssrLoadModule('/src/benchmarks/globalAssignment/browser/globalAssignmentBrowserAnalysis.ts')
  planModule = await server.ssrLoadModule('/src/benchmarks/globalAssignment/browser/globalAssignmentBrowserMeasurementPlan.ts')
  registration = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationRegistration.ts')
} finally {
  await server.close()
}

const plan = atHead(PLAN_DOC)
const extracted = planModule.extractGabMeasurementPlan(plan.text)
if (extracted.issues.length > 0) throw new Error(`The plan at ${plan.file} cannot be read: ${extracted.issues.join(' ')}`)
const planIssues = planModule.gabMeasurementPlanIssues(extracted.plan)
if (planIssues.length > 0) throw new Error(`The plan at ${plan.file} is invalid: ${planIssues.join(' / ')}`)
const d1cResult = atHead(extracted.plan.references.d1cPublicResult.path)
const registeredConditions = registration.registeredD1cConditions()
const registered = { source: 'registeredD1cConditions', materialization: registeredConditions.materialization, verification: registeredConditions.verification, fingerprint: registration.d1cRegistrationFingerprint() }
const ports = { sha256Text: async text => sha256(Buffer.from(text, 'utf8')) }

if (validateOnly) {
  const value = extracted.plan
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
  const checks = {
    planShape: true,
    d1cResultSha256MatchesPlan: d1cResult.sha256 === value.references.d1cPublicResult.sha256,
    conditionsAreRegistered: value.conditions.source === registered.source && same(value.conditions.materialization, registered.materialization) && same(value.conditions.verification, registered.verification),
    registrationFingerprintMatches: value.conditions.registrationFingerprint === registered.fingerprint,
  }
  const reading = analysis.readGabD1cReference(JSON.parse(d1cResult.text))
  checks.d1cReferenceAccepted = reading.issues.length === 0
  checks.planMatchesD1c = same(value.export, reading.export) && same(value.calculationContext, reading.calculationContext)
  const ok = Object.values(checks).every(Boolean)
  console.log(JSON.stringify({ plan: plan.file, planSha256: plan.sha256, d1cResult: d1cResult.file, d1cResultSha256: d1cResult.sha256, environments: value.environments.map(environment => ({ environmentId: environment.environmentId, status: environment.status, slots: environment.slots.length, requiredComparisonRuns: environment.requiredComparisonRuns })), checks, ok }, null, 2))
  process.exitCode = ok ? 0 : 1
} else {
  const names = (await readdir(rawDir)).filter(name => name.endsWith('.json')).sort()
  if (names.length === 0) throw new Error(`No Browser raw file (*.json) in ${rawDir}.`)
  const browserRaw = []
  for (const name of names) browserRaw.push(await readSource(join(rawDir, name)))
  const driver = driverPath === undefined ? null : await readSource(driverPath)
  let node = null
  if (nodeOutputPath !== undefined) {
    const output = await readSource(nodeOutputPath)
    const runs = JSON.parse(output.text).runs ?? []
    const recordOf = async id => {
      const run = runs.find(entry => entry?.id === id)
      return typeof run?.recordFile === 'string' ? readSource(join(nodeRunDir, run.recordFile)) : null
    }
    node = { output, first: await recordOf('first'), fresh: await recordOf('fresh') }
  }
  const sources = { measurementHead: head, plan, d1cResult, browserRaw, driver, node, registered }
  if (publicPath !== undefined) {
    const published = await analysis.deriveGabPublicResult(sources, ports)
    const issues = await analysis.gabPublicResultIssues(published, sources, ports)
    if (issues.length > 0) {
      console.error(JSON.stringify({ written: false, issues }, null, 2))
      process.exit(1)
    }
    const text = JSON.stringify(published, null, 2) + '\n'
    await writeFile(publicPath, text, { flag: 'wx' })
    console.log(JSON.stringify({
      written: publicPath, bytes: Buffer.byteLength(text), sha256: sha256(text), sources: published.derivation.sources.length,
      environments: published.environments.map(environment => ({ environmentId: environment.environmentId, confirmation: environment.confirmation, parity: environment.parity?.status ?? null, reasonCodes: environment.parity?.reasonCodes ?? [], cancelTrials: environment.cancelTrials.map(trial => `${trial.slotId}:${trial.status}`) })),
    }, null, 2))
  } else {
    const text = await readFile(checkPath, 'utf8')
    const published = JSON.parse(text)
    const issues = await analysis.gabPublicResultIssues(published, sources, ports)
    if (text !== JSON.stringify(published, null, 2) + '\n') issues.push('The public RESULT is not in the canonical serialization (JSON.stringify(value, null, 2) + newline).')
    console.log(JSON.stringify({ checked: checkPath, sha256: sha256(text), ok: issues.length === 0, issues, sources: published.derivation?.sources?.map(file => `${file.file} ${file.bytes} ${file.sha256}`) ?? [] }, null, 2))
    if (issues.length > 0) process.exitCode = 1
  }
}
