// Issue #154 Phase 2-C2.6-B2-C2B2C post-hoc only: the raw record of an INTERRUPTED Stage 1 measurement.
//
// run-planner-global-phase2c26b2c2b2c.mjs writes its aggregate raw only when every task ended. When the parent runner is
// stopped (by the project owner, a crash or a host restart) this script rebuilds the same raw shape from what the run left,
// WITHOUT running anything and WITHOUT changing any file of the run dir:
//   - start-attestation.json: the runner's own launch attestation, written before any child. When present it MUST verify
//     (verifyPhase2C26B2C2B2CStartAttestation(): authored by the runner, the given --measured-head, the benchmark code SHA-256
//     recomputed from that HEAD's git objects by the runner rule, the Export / manifest SHA-256 of the files given here, the
//     manifest Target IDs, a clean launch, the registered conditions, createdAt not later than the tasks child start) or this
//     script fails closed. When absent the raw carries no attestation and can never be formal;
//   - processes.jsonl: one line per ended child, appended by the parent (outcome, exact wall time, exit code, stderr tail, last
//     IPC memory, record file SHA-256);
//   - the runner log: START / outcome lines, cross-checked against processes.jsonl;
//   - tasks.record.json (task construction), stage1-*.task.json / *.record.json / *.memory.jsonl.
// A task the parent never ran is `notRun` (never Candidate 0, never a failure); a task the parent started but never saw end
// (the child was in flight at the interruption) is `notRun` too and is named; its record, if an orphaned child wrote one, is
// not read.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { lstatSync, existsSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpus, totalmem, release, platform, arch } from 'node:os'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const paths = { runDir: option('--run-dir'), log: option('--log'), export: option('--export'), targets: option('--targets'), output: option('--output') }
const measuredHead = option('--measured-head'), stoppedAt = option('--stopped-at'), stopReason = option('--stop-reason')
const allowNonformal = args.includes('--allow-nonformal')
if (Object.values(paths).some(v => !v) || !measuredHead || !stoppedAt || !stopReason) {
  throw new Error('Usage: node scripts/reconstruct-planner-global-phase2c26b2c2b2c-partial-raw.mjs --run-dir <run dir> --log <runner log> --export <external.json> --targets <manifest> --measured-head <sha> --stopped-at <ISO> --stop-reason <text> --output <new .json.local> [--allow-nonformal]')
}
if (lstatSync(paths.output, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(paths.output)}`)
if (!/^[0-9a-f]{40}$/.test(measuredHead)) throw new Error('--measured-head is not a commit SHA.')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })

// The benchmark code SHA-256 of the measured HEAD, by the runner's own rule (ls-files of the code paths, file + content).
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const codeHash = createHash('sha256')
for (const file of git('ls-tree', '-r', '--name-only', measuredHead, '--', ...codePaths).split(/\r?\n/).filter(Boolean)) {
  codeHash.update(file + '\0'); codeHash.update(gitBuffer('show', `${measuredHead}:${file}`)); codeHash.update('\0')
}
const recomputedBenchmarkCodeSha256 = codeHash.digest('hex')

const rawExport = await readFile(paths.export)
const rawTargets = await readFile(paths.targets)
const logText = (await readFile(paths.log)).toString('utf8')
const files = (await readdir(paths.runDir)).sort()
// An inventory of the run dir as found (every file name and SHA-256), so the record shows nothing was rewritten afterwards.
const inventory = []
for (const file of files) inventory.push([file, sha256(await readFile(join(paths.runDir, file)))])
const runDirInventorySha256 = sha256(JSON.stringify(inventory))

// processes.jsonl: one line per ended child, written by the parent.
const ended = new Map()
if (files.includes('processes.jsonl')) {
  for (const line of (await readFile(join(paths.runDir, 'processes.jsonl'))).toString('utf8').split(/\r?\n/).filter(Boolean)) {
    const entry = JSON.parse(line)
    const id = entry.id === 'tasks' ? 'tasks' : entry.id.replace(/^stage1-/, '')
    if (ended.has(id)) throw new Error(`processes.jsonl names ${id} twice.`)
    ended.set(id, entry)
  }
}
// The runner log: START and outcome lines, cross-checked against processes.jsonl.
const OUTCOME = { COMPLETED: 'completed', TIMEOUT: 'timeout', OUT_OF_MEMORY: 'out_of_memory', PROCESS_FAILURE: 'process_failure' }
const logStarted = new Map(), logEnded = new Map()
for (const line of logText.split(/\r?\n/)) {
  const s = line.match(/^(\S+) START (stage1-(t\d+-r\d+)|tasks) pid=\d+$/)
  if (s) { const id = s[3] ?? 'tasks'; if (logStarted.has(id)) throw new Error(`The log starts ${id} twice.`); logStarted.set(id, s[1]); continue }
  const m = line.match(/^(\S+) (COMPLETED|TIMEOUT|OUT_OF_MEMORY|PROCESS_FAILURE) (stage1-(t\d+-r\d+)|tasks)\b/)
  if (m) { const id = m[4] ?? 'tasks'; if (logEnded.has(id)) throw new Error(`The log ends ${id} twice.`); logEnded.set(id, { endedAt: m[1], outcome: OUTCOME[m[2]] }) }
}
for (const [id, entry] of ended) {
  const log = logEnded.get(id)
  if (!log || log.outcome !== entry.outcome || log.endedAt !== entry.endedAt || logStarted.get(id) !== entry.startedAt) throw new Error(`${id}: processes.jsonl and the runner log disagree.`)
}
for (const id of logEnded.keys()) if (!ended.has(id)) throw new Error(`${id}: the log ends a child processes.jsonl does not hold.`)

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const c2b2c = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2C.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const parsed = c2b2c.parsePhase2C26B2C2B2CTargetManifest(JSON.parse(rawTargets.toString('utf8')))
  if (!parsed.valid) throw new Error(`The Target manifest is not valid: ${parsed.issues.join('; ')}`)
  const manifest = parsed.manifest
  if (sha256(rawExport) !== manifest.exportSha256) throw new Error('The Export is not the one the Target manifest names.')
  const tasksEnded = ended.get('tasks')
  if (!tasksEnded || tasksEnded.outcome !== 'completed') throw new Error('processes.jsonl does not record a completed tasks child.')

  // The runner start attestation: present -> it must verify (fail closed); absent -> no launch provenance at all.
  const attestationName = c2b2c.PHASE2C26B2C2B2C_START_ATTESTATION_FILE
  let launchAttestation = null, attestation = null, attestationCheck = null
  if (files.includes(attestationName)) {
    const raw = await readFile(join(paths.runDir, attestationName))
    attestation = JSON.parse(raw.toString('utf8'))
    const check = c2b2c.verifyPhase2C26B2C2B2CStartAttestation(attestation, { repositoryHead: measuredHead, benchmarkCodeSha256: recomputedBenchmarkCodeSha256,
      exportSha256: sha256(rawExport), targetManifestSha256: sha256(rawTargets), targetWeaponIds: manifest.targetWeaponIds, firstChildStartedAt: tasksEnded.startedAt })
    // An integrity issue always fails closed. A truthfully attested non-formal launch (uncommitted / smoke / another
    // condition) is reconstructed only with --allow-nonformal, and stays non-formal (the analyzer re-verifies it).
    if (check.integrityIssues.length > 0) throw new Error(`The runner start attestation does not verify: ${check.integrityIssues.join('; ')}`)
    if (!check.verified && !allowNonformal) throw new Error(`The runner start attestation attests a non-formal launch (${check.issues.join('; ')}); pass --allow-nonformal to reconstruct it as non-formal.`)
    attestationCheck = check
    launchAttestation = { file: attestationName, bytes: raw.length, sha256: sha256(raw), createdAt: attestation.createdAt }
  }

  const readJson = async file => { const raw = await readFile(join(paths.runDir, file)); return { raw, body: JSON.parse(raw.toString('utf8')) } }
  const tasksRecord = await readJson('tasks.record.json')
  if (tasksEnded.recordFile?.sha256 !== sha256(tasksRecord.raw)) throw new Error('tasks.record.json is not the record the parent hashed.')
  const construction = tasksRecord.body.result.construction
  const tasks = construction.tasks
  if (!construction.valid || tasks.length !== c2b2c.PHASE2C26B2C2B2C_EXPECTED_TASKS) throw new Error('The tasks record is not a valid 128-task construction.')

  const stage1 = []
  const notRun = []
  for (const task of tasks) {
    const id = task.taskId
    const entry = ended.get(id)
    const taskFile = `stage1-${id}.task.json`
    if (!entry) {
      notRun.push({ taskId: id, taskFileWritten: files.includes(taskFile), startedWithoutParentOutcome: logStarted.has(id) })
      continue
    }
    const written = await readJson(taskFile)
    if (JSON.stringify(written.body) !== JSON.stringify(task)) throw new Error(`${id}: the task file is not the constructed task.`)
    const recordName = `stage1-${id}.record.json`
    const record = entry.outcome === 'completed' ? await readJson(recordName) : null
    if (record && (entry.recordFile?.sha256 !== sha256(record.raw) || JSON.stringify(record.body.task) !== JSON.stringify(task) || record.body.role !== 'search')) throw new Error(`${id}: the record is not the one the parent hashed for this task.`)
    if (entry.outcome !== 'completed' && files.includes(recordName)) throw new Error(`${id}: a record for a ${entry.outcome} child.`)
    const result = record?.body.result ?? null
    stage1.push({ taskId: id, task, outcome: c2b2c.phase2c26b2c2b2cTaskOutcome(id, entry.outcome, result),
      process: { outcome: entry.outcome, wallMs: entry.wallMs, timedOut: entry.timedOut, budgetMs: entry.budgetMs, exitCode: entry.exitCode, stderrTail: entry.stderrTail,
        startedAt: entry.startedAt, endedAt: entry.endedAt },
      recordFile: entry.recordFile, childWallMs: record?.body.wallMs ?? null, scheduleMs: record?.body.scheduleMs ?? null, yields: record?.body.yields ?? entry.lastIpcYields ?? null,
      memory: record?.body.memory ?? null, lastIpcMemory: entry.lastIpcMemory, calculationContext: record?.body.calculationContext ?? null,
      researchMaxPlanSteps: record?.body.researchMaxPlanSteps ?? null, rngEngineVersion: record?.body.rngEngineVersion ?? null,
      contextMismatchIssues: result?.status === 'context_mismatch' ? result.issues : null,
      capture: result?.status === 'searched' ? { termination: result.search.termination, candidateCount: result.search.candidates.length, capturedCosts: result.search.capturedCosts,
        captureComplete: result.search.captureComplete, safetyCapHit: result.search.safetyCapHit, elapsedMs: result.search.elapsedMs } : null })
  }
  // The parent ran tasks strictly in order (concurrency 1): the ended tasks must be a prefix and every other task notRun.
  const ranIds = stage1.map(r => r.taskId)
  if (JSON.stringify(ranIds) !== JSON.stringify(tasks.slice(0, ranIds.length).map(t => t.taskId))) throw new Error('The ran tasks are not a prefix of the task order.')
  if (ranIds.length + notRun.length !== tasks.length) throw new Error('Ran + notRun is not every task.')
  const traced = notRun.filter(t => t.taskFileWritten || t.startedWithoutParentOutcome)
  if (traced.length > 1 || (traced.length === 1 && traced[0].taskId !== notRun[0].taskId)) throw new Error('A notRun task trace other than the next task in order.')

  const stage1Conditions = { ...c2b2c.PHASE2C26B2C2B2C_STAGE1 }
  const attested = attestation !== null
  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    stage1: attested ? attestation.stage1 : stage1Conditions, tasksBudgetMs: c2b2c.PHASE2C26B2C2B2C_TASKS_BUDGET_MS, contextBudget: c2b2c.PHASE2C26B2C2B2C_CONTEXT_BUDGET,
    targets: c2b2c.PHASE2C26B2C2B2C_TARGETS, expectedTasks: c2b2c.PHASE2C26B2C2B2C_EXPECTED_TASKS, maxCostCohorts: c2b2c.PHASE2C26B2C2B2C_MAX_COST_COHORTS,
    candidateSafetyCap: c2b2c.PHASE2C26B2C2B2C_CANDIDATE_SAFETY_CAP, capturePrefixes: c2b2c.PHASE2C26B2C2B2C_CAPTURE_PREFIXES, extentLabel: c2b2c.PHASE2C26B2C2B2C_EXTENT_LABEL,
    extent: { ...c2b2c.PHASE2C26B2C2B2C_EXTENT }, memorySampleIntervalMs: c2b2c.PHASE2C26B2C2B2C_MEMORY_SAMPLE_INTERVAL_MS,
    nodeYield: c2b2c.PHASE2C26B2C2B2C_NODE_YIELD, notRun: [...c2b2c.PHASE2C26B2C2B2C_NOT_RUN], registeredP1: c2b2c.PHASE2C26B2C2B2C_REGISTERED_P1,
    oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false,
    oracleInformedCommonExtent: true, commonExtentForEveryTask: true, perTargetExtent: false, targetIndividualOracleExtentAsSearchInput: false, ladderRungsSearched: ['L2'],
    // With a verified attestation the launch values are the runner's own (copied from it); without one they are reconstruction
    // inputs, the launch working tree is unknown (null, never false) and no attestation is invented.
    repositoryHead: attested ? attestation.repositoryHead : measuredHead, repositoryHeadSource: attested ? 'runner_start_attestation' : 'post_hoc_reconstruction_argument',
    uncommittedBenchmarkCode: attested ? attestation.uncommittedBenchmarkCode : null, benchmarkCodeSha256: attested ? attestation.benchmarkCodeSha256 : recomputedBenchmarkCodeSha256,
    benchmarkCodeSha256Source: attested ? 'runner_start_attestation (equal to the recomputation from the measured HEAD git objects)' : 'recomputed post hoc from the git objects of the reconstruction-argument HEAD',
    exportFileName: basename(paths.export), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    targetManifestFileName: basename(paths.targets), targetManifestSha256: sha256(rawTargets), targetManifestBytes: rawTargets.length, targetManifestSourceResultSha256: manifest.sourceResultSha256,
    smoke: attested ? attestation.smoke : null }
  const tasksChild = { process: { ...tasksEnded, recordFile: undefined }, recordFile: tasksEnded.recordFile, childWallMs: tasksRecord.body.wallMs, scheduleMs: tasksRecord.body.scheduleMs,
    memory: tasksRecord.body.memory, researchMaxPlanSteps: tasksRecord.body.researchMaxPlanSteps, calculationContext: tasksRecord.body.calculationContext,
    rngEngineVersion: tasksRecord.body.rngEngineVersion, scheduleSummary: tasksRecord.body.result.scheduleSummary, construction: { valid: construction.valid, issues: construction.issues } }
  const out = { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2C: E1 ∩ L2 P1 top-32 reservation contexts searched at the common L2 extent (Node Research run, raw, interrupted; reconstructed post hoc)',
    measuredAt: attested ? attestation.createdAt : tasksEnded.startedAt, environment, launchAttestation, targetWeaponIds: manifest.targetWeaponIds,
    status: 'interrupted',
    interruption: { stoppedAt, reason: stopReason, ranTasks: ranIds.length, notRunTasks: notRun.length, notRunTaskIds: notRun.map(t => t.taskId),
      taskFileWrittenWithoutChild: notRun.filter(t => t.taskFileWritten && !t.startedWithoutParentOutcome).map(t => t.taskId),
      startedWithoutParentOutcome: notRun.filter(t => t.startedWithoutParentOutcome).map(t => t.taskId), noRetry: true, conditionsUnchanged: true },
    reconstruction: { script: 'scripts/reconstruct-planner-global-phase2c26b2c2b2c-partial-raw.mjs', postHoc: true, childRecordsModified: false, searchRun: false,
      runDir: basename(resolve(paths.runDir)), runDirFiles: inventory.length, runDirInventorySha256, log: { file: basename(paths.log), bytes: Buffer.byteLength(logText), sha256: sha256(logText) },
      measuredHeadArgument: measuredHead, recomputedBenchmarkCodeSha256, startAttestationPresent: attested, startAttestationVerifiedAtReconstruction: attestationCheck?.verified ?? false,
      startAttestationNonFormalIssues: attestationCheck === null ? null : attestationCheck.issues,
      lostFields: ['processes (the parent in-memory process table; every ended child is in processes.jsonl instead)'],
      environmentRecomputed: 'host / Node / module constants recomputed at reconstruction; the launch values come from the runner start attestation when present' },
    tasksChild, tasks, stage1, notRun, processes: null, wallMs: Date.parse(stoppedAt) - Date.parse(tasksEnded.startedAt) }
  const text = JSON.stringify(out, null, 2) + '\n'
  await writeFile(paths.output, text, { flag: 'wx' })
  const count = o => stage1.filter(r => r.process.outcome === o).length
  console.log(JSON.stringify({ output: resolve(paths.output), sha256: sha256(text), startAttestation: launchAttestation, recomputedBenchmarkCodeSha256, planned: tasks.length, ran: ranIds.length,
    completed: count('completed'), timeout: count('timeout'), outOfMemory: count('out_of_memory'), processFailure: count('process_failure'), notRun: notRun.length,
    runDirFiles: inventory.length, runDirInventorySha256, runDirExists: existsSync(paths.runDir) }, null, 2))
} finally {
  await server.close()
}
