// Issue #154 Global Assignment Phase D-0C (Research only). Derives the public RESULT of a D-0C materialization run from its raw
// outputs (the runner's aggregated RESULT and the run directory, both git-ignored under .local/), or checks a public RESULT
// against them (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D0C.md). The derivation itself is deriveD0cPublicResult() in
// src/benchmarks/globalAssignment/materializationFormalResult.ts; this script only reads and hashes the files (SHA-256 of every
// source file, and of each measured record's semantic part with the runner's own rule) and writes the result exclusively.
// It reads no Export, runs no RNG prediction, Search, Planner or Trace Replay, and changes no raw file.
//
//   node scripts/derive-planner-global-assignment-d0c-result.mjs --result <aggregated .json> --run-dir <run dir> --public <new public .json>
//   node scripts/derive-planner-global-assignment-d0c-result.mjs --result <aggregated .json> --run-dir <run dir> --check <public .json>
//
// --public refuses an existing file; it writes nothing when the derived RESULT fails its own checks (re-derivation, semantic hash
// linkage, outcome consistency, data minimization). --check re-derives and compares, and exits 1 on any difference.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const SCRIPT_PATH = 'scripts/derive-planner-global-assignment-d0c-result.mjs'
const USAGE = `Usage: node ${SCRIPT_PATH} --result <aggregated .json> --run-dir <run dir> (--public <new public .json> | --check <public .json>)`
const KNOWN_OPTIONS = new Set(['--result', '--run-dir', '--public', '--check'])
const args = process.argv.slice(2)
const flags = args.filter(value => value.startsWith('--'))
for (const flag of flags) if (!KNOWN_OPTIONS.has(flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`)
if (new Set(flags).size !== flags.length) throw new Error(`Duplicate option; specify each once. ${USAGE}`)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
for (const flag of flags) if (option(flag) === undefined || option(flag).startsWith('--')) throw new Error(`${flag} needs a value. ${USAGE}`)
const resultPath = option('--result'), runDir = option('--run-dir'), publicPath = option('--public'), checkPath = option('--check')
if (!resultPath || !runDir || (publicPath === undefined) === (checkPath === undefined)) throw new Error(USAGE)
const sha256 = value => createHash('sha256').update(value).digest('hex')

const resultRaw = await readFile(resultPath)
const output = JSON.parse(resultRaw.toString('utf8'))
// The aggregated RESULT names its own run directory: a RESULT is never paired with another run's records.
if (typeof output.runDir !== 'string' || basename(output.runDir) !== basename(runDir)) throw new Error(`The RESULT belongs to the run directory ${String(output.runDir)}, not ${runDir}.`)
const files = [{ file: basename(resultPath), bytes: resultRaw.length, sha256: sha256(resultRaw) }]
for (const name of (await readdir(runDir)).sort()) {
  const raw = await readFile(join(runDir, name))
  files.push({ file: `${basename(runDir)}/${name}`, bytes: raw.length, sha256: sha256(raw) })
}
const records = []
const semanticSha256ByRun = {}
for (const run of output.runs.filter(value => value.status === 'measured')) {
  if (typeof run.recordFile !== 'string') throw new Error(`The measured run ${run.id} names no record file.`)
  const record = JSON.parse(await readFile(join(runDir, run.recordFile), 'utf8'))
  records.push({ id: run.id, record })
  semanticSha256ByRun[run.id] = sha256(JSON.stringify(record.semantic))
}
const sources = { output, records, files, semanticSha256ByRun }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
let derive
try {
  derive = await server.ssrLoadModule('/src/benchmarks/globalAssignment/materializationFormalResult.ts')
} finally {
  await server.close()
}

if (publicPath !== undefined) {
  const published = derive.deriveD0cPublicResult(sources)
  const issues = derive.d0cPublicResultIssues(published, sources)
  if (issues.length > 0) {
    console.error(JSON.stringify({ written: false, issues }, null, 2))
    process.exit(1)
  }
  const text = JSON.stringify(published, null, 2) + '\n'
  await writeFile(publicPath, text, { flag: 'wx' })
  console.log(JSON.stringify({ written: publicPath, bytes: Buffer.byteLength(text), sha256: sha256(text), formalValidity: published.formalValidity.status, materialization: published.materializationOutcome.verdict, sources: files.length }))
} else {
  const text = await readFile(checkPath, 'utf8')
  const published = JSON.parse(text)
  const issues = derive.d0cPublicResultIssues(published, sources)
  if (text !== JSON.stringify(published, null, 2) + '\n') issues.push('The public RESULT is not in the canonical serialization (JSON.stringify(value, null, 2) + newline).')
  console.log(JSON.stringify({ checked: checkPath, sha256: sha256(text), ok: issues.length === 0, issues, sources: files.map(file => `${file.file} ${file.bytes} ${file.sha256}`) }, null, 2))
  if (issues.length > 0) process.exitCode = 1
}
