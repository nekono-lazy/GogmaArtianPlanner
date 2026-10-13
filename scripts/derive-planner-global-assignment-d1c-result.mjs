// Issue #154 Global Assignment Phase D-1C (Research only). Derives the public RESULT of a D-1C formal measurement from its raw outputs
// (the runner's raw RESULT and the run directory, both git-ignored under .local/), or checks a public RESULT against them
// (docs/PLANNER_GLOBAL_ASSIGNMENT_RESEARCH_D1C.md). The derivation itself is deriveD1cPublicResult() in
// src/benchmarks/globalAssignment/verificationFormalResult.ts: it rebuilds the observations from the raw files, re-derives the whole
// conclusion (integrity, formal validity, candidate outcome, acceptance) and requires it to be the runner's. This script only reads and
// hashes the files (SHA-256 of every source file, and of each record's semantic parts with the runner's own rule) and writes the result
// exclusively. It reads no Export, runs no RNG prediction, Search, Planner or Trace Replay, and changes no raw file.
//
//   node scripts/derive-planner-global-assignment-d1c-result.mjs --result <raw .json> --run-dir <run dir> --public <new public .json>
//   node scripts/derive-planner-global-assignment-d1c-result.mjs --result <raw .json> --run-dir <run dir> --check <public .json>
//
// --public refuses an existing file; it writes nothing when the derived RESULT fails its own checks (re-derivation, start record,
// readings, semantic hash linkage, conclusion, data minimization). --check re-derives and compares, and exits 1 on any difference.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const SCRIPT_PATH = 'scripts/derive-planner-global-assignment-d1c-result.mjs'
const USAGE = `Usage: node ${SCRIPT_PATH} --result <raw .json> --run-dir <run dir> (--public <new public .json> | --check <public .json>)`
const KNOWN_OPTIONS = new Set(['--result', '--run-dir', '--public', '--check'])
const START_FILE = 'start.json'
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
// The raw RESULT names its own run directory: a RESULT is never paired with another measurement's records.
if (typeof output.runDir !== 'string' || basename(output.runDir) !== basename(runDir)) throw new Error(`The RESULT belongs to the run directory ${String(output.runDir)}, not ${runDir}.`)
const files = [{ file: basename(resultPath), bytes: resultRaw.length, sha256: sha256(resultRaw) }]
const listFiles = async (directory, prefix) => {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await listFiles(path, `${prefix}/${entry.name}`)
    else {
      const raw = await readFile(path)
      files.push({ file: `${prefix}/${entry.name}`, bytes: raw.length, sha256: sha256(raw) })
    }
  }
}
await listFiles(runDir, basename(runDir))
let startRecordText = null
try {
  startRecordText = await readFile(join(runDir, START_FILE), 'utf8')
} catch {
  startRecordText = null
}
// The runner's readChild() rule: parse the record of a completed child and re-hash JSON.stringify() of each semantic record it carries.
const readChild = async (directory, side) => {
  const reading = { process: side.process.outcome, record: null, readError: null, recomputed: { materializationSha256: null, verificationSha256: null } }
  if (side.process.outcome !== 'completed' || !side.process.recordFile) return reading
  try {
    reading.record = JSON.parse(await readFile(join(directory, side.process.recordFile), 'utf8'))
  } catch (error) {
    reading.readError = `record unreadable: ${error?.message ?? String(error)}`
    return reading
  }
  if (reading.record?.materialization?.semantic !== undefined) reading.recomputed.materializationSha256 = sha256(JSON.stringify(reading.record.materialization.semantic))
  if (reading.record?.verification?.semantic !== undefined) reading.recomputed.verificationSha256 = sha256(JSON.stringify(reading.record.verification.semantic))
  return reading
}
const children = []
for (const run of output.runs) {
  const directory = join(runDir, run.dir)
  const first = await readChild(directory, run.first)
  let entrySet = null
  if (typeof first.record?.entrySet?.file === 'string') {
    try {
      entrySet = JSON.parse(await readFile(join(directory, first.record.entrySet.file), 'utf8'))
    } catch {
      entrySet = null
    }
  }
  children.push({ runIndex: run.runIndex, role: 'first', reading: first, entrySet })
  if (run.fresh !== null) children.push({ runIndex: run.runIndex, role: 'fresh', reading: await readChild(directory, run.fresh), entrySet: null })
}
const sources = { output, startRecordText, children, files }

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
let derive
try {
  derive = await server.ssrLoadModule('/src/benchmarks/globalAssignment/verificationFormalResult.ts')
} finally {
  await server.close()
}

if (publicPath !== undefined) {
  const published = derive.deriveD1cPublicResult(sources)
  const issues = derive.d1cPublicResultIssues(published, sources)
  if (issues.length > 0) {
    console.error(JSON.stringify({ written: false, issues }, null, 2))
    process.exit(1)
  }
  const text = JSON.stringify(published, null, 2) + '\n'
  await writeFile(publicPath, text, { flag: 'wx' })
  console.log(JSON.stringify({ written: publicPath, bytes: Buffer.byteLength(text), sha256: sha256(text), formalValidity: published.formalValidity.status, candidateOutcome: published.candidateOutcome.kind, acceptance: published.acceptance.status, sources: files.length }))
} else {
  const text = await readFile(checkPath, 'utf8')
  const published = JSON.parse(text)
  const issues = derive.d1cPublicResultIssues(published, sources)
  if (text !== JSON.stringify(published, null, 2) + '\n') issues.push('The public RESULT is not in the canonical serialization (JSON.stringify(value, null, 2) + newline).')
  console.log(JSON.stringify({ checked: checkPath, sha256: sha256(text), ok: issues.length === 0, issues, sources: files.map(file => `${file.file} ${file.bytes} ${file.sha256}`) }, null, 2))
  if (issues.length > 0) process.exitCode = 1
}
