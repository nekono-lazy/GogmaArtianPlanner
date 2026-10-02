// Issue #154 Phase 2-C2.6-B2-C2B2A post-hoc only: the raw record of an INTENTIONALLY STOPPED formal Stage 1.
//
// run-planner-global-phase2c26b2c2b2a.mjs writes its aggregate raw only when every task ended. The formal Stage 1 was
// stopped on purpose at a child boundary (the project owner closed the Phase as B2C2B2A_INCOMPLETE once the resource
// evidence sufficed), so this script rebuilds the raw from what the run left, WITHOUT running anything and WITHOUT
// changing any child record:
//   - the run dir: tasks.record.json (task construction), stage1-*.task.json / *.record.json / *.memory.jsonl;
//   - the runner log: one outcome line per ended child (COMPLETED / TIMEOUT / OUT_OF_MEMORY / PROCESS_FAILURE, wall seconds,
//     last IPC heap);
//   - the measured HEAD (git objects, for the benchmark code SHA-256 the runner computed the same way) and the inputs.
// Child records are read and hashed only. A task the parent never ran is `notRun` (never Candidate 0, never a failure);
// a task file the parent wrote right before the stop without a child process is `notRun` too, and is named.
// Every field the runner would have taken from its in-memory process table and that only the log keeps (process wall,
// last IPC heap) is marked reconstructed; exit codes and stderr tails of failed children are lost and recorded as null.
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
if (Object.values(paths).some(v => !v) || !measuredHead || !stoppedAt || !stopReason) {
  throw new Error('Usage: node scripts/reconstruct-planner-global-phase2c26b2c2b2a-partial-raw.mjs --run-dir <run dir> --log <runner log> --export <external.json> --targets <manifest> --measured-head <sha> --stopped-at <ISO> --stop-reason <text> --output <new .json.local>')
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
const benchmarkCodeSha256 = codeHash.digest('hex')

const rawExport = await readFile(paths.export)
const rawTargets = await readFile(paths.targets)
const logText = (await readFile(paths.log)).toString('utf8')
const files = (await readdir(paths.runDir)).sort()
// An inventory of the run dir as found (every file name and SHA-256), so the record shows nothing was rewritten afterwards.
const inventory = []
for (const file of files) inventory.push([file, sha256(await readFile(join(paths.runDir, file)))])
const runDirInventorySha256 = sha256(JSON.stringify(inventory))

// The runner log: one line per ended child.
const OUTCOME = { COMPLETED: 'completed', TIMEOUT: 'timeout', OUT_OF_MEMORY: 'out_of_memory', PROCESS_FAILURE: 'process_failure' }
const ended = new Map()
for (const line of logText.split(/\r?\n/)) {
  const m = line.match(/^(\S+) (COMPLETED|TIMEOUT|OUT_OF_MEMORY|PROCESS_FAILURE) (stage1-(t\d+-r\d+)|tasks)\b.* ([0-9.]+)s heap<=(\d+)MB$/)
  if (!m) continue
  const id = m[4] ?? 'tasks'
  if (ended.has(id)) throw new Error(`The log names ${id} twice.`)
  ended.set(id, { endedAt: m[1], outcome: OUTCOME[m[2]], wallMs: Number(m[5]) * 1000, lastIpcHeapMb: Number(m[6]) })
}

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const c2b2a = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2A.ts')
  const { ProductionRngEngine } = await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')
  const parsed = c2b2a.parsePhase2C26B2C2B2ATargetManifest(JSON.parse(rawTargets.toString('utf8')))
  if (!parsed.valid) throw new Error(`The Target manifest is not valid: ${parsed.issues.join('; ')}`)
  const manifest = parsed.manifest
  if (sha256(rawExport) !== manifest.exportSha256) throw new Error('The Export is not the one the Target manifest names.')

  const readJson = async file => { const raw = await readFile(join(paths.runDir, file)); return { raw, body: JSON.parse(raw.toString('utf8')) } }
  const tasksRecord = await readJson('tasks.record.json')
  const construction = tasksRecord.body.result.construction
  const tasks = construction.tasks
  if (!construction.valid || tasks.length !== c2b2a.PHASE2C26B2C2B2A_EXPECTED_TASKS) throw new Error('The tasks record is not a valid 352-task construction.')
  const tasksEnded = ended.get('tasks')
  if (!tasksEnded || tasksEnded.outcome !== 'completed') throw new Error('The log does not record a completed tasks child.')

  // The tasks the parent ran, in its pool order (concurrency 1 = task order), and the ones it never ran.
  const lastMemory = async id => {
    const file = `stage1-${id}.memory.jsonl`
    if (!files.includes(file)) return null
    const lines = (await readFile(join(paths.runDir, file))).toString('utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))
    return lines.at(-1) ?? null
  }
  const stage1 = []
  const notRun = []
  for (const task of tasks) {
    const id = task.taskId
    const log = ended.get(id)
    const taskFile = `stage1-${id}.task.json`
    if (!log) {
      if (files.includes(`stage1-${id}.record.json`) || files.includes(`stage1-${id}.memory.jsonl`)) throw new Error(`${id}: a child trace without a log outcome.`)
      notRun.push({ taskId: id, taskFileWritten: files.includes(taskFile) })
      continue
    }
    const written = await readJson(taskFile)
    if (JSON.stringify(written.body) !== JSON.stringify(task)) throw new Error(`${id}: the task file is not the constructed task.`)
    const recordName = `stage1-${id}.record.json`
    const record = log.outcome === 'completed' && files.includes(recordName) ? await readJson(recordName) : null
    if (log.outcome === 'completed' && record === null) throw new Error(`${id}: completed without a record.`)
    if (log.outcome !== 'completed' && files.includes(recordName)) throw new Error(`${id}: a record for a ${log.outcome} child.`)
    if (record && (JSON.stringify(record.body.task) !== JSON.stringify(task) || record.body.role !== 'search')) throw new Error(`${id}: the record is not this task's search record.`)
    const result = record?.body.result ?? null
    const memory = await lastMemory(id)
    const lastIpcMemory = { maxHeapUsedBytes: Math.max(log.lastIpcHeapMb * 2 ** 20, memory?.maxima.maxHeapUsedBytes ?? 0), maxRssBytes: memory?.maxima.maxRssBytes ?? 0 }
    stage1.push({ taskId: id, task, outcome: c2b2a.phase2c26b2c2b2aTaskOutcome(id, log.outcome, result),
      process: { outcome: log.outcome, wallMs: log.wallMs, timedOut: log.outcome === 'timeout', budgetMs: c2b2a.PHASE2C26B2C2B2A_STAGE1.budgetMs, exitCode: null, stderrTail: null, endedAt: log.endedAt },
      recordFile: record === null ? null : { file: recordName, bytes: record.raw.length, sha256: sha256(record.raw) }, childWallMs: record?.body.wallMs ?? null, scheduleMs: record?.body.scheduleMs ?? null,
      yields: record?.body.yields ?? memory?.yields ?? null, memory: record?.body.memory ?? null, lastIpcMemory, calculationContext: record?.body.calculationContext ?? null,
      researchMaxPlanSteps: record?.body.researchMaxPlanSteps ?? null, rngEngineVersion: record?.body.rngEngineVersion ?? null,
      contextMismatchIssues: result?.status === 'context_mismatch' ? result.issues : null,
      capture: result?.status === 'searched' ? { termination: result.search.termination, candidateCount: result.search.candidates.length, capturedCosts: result.search.capturedCosts,
        captureComplete: result.search.captureComplete, safetyCapHit: result.search.safetyCapHit, elapsedMs: result.search.elapsedMs } : null,
      reconstructed: { processWallMs: 'runner log, 0.1 s resolution', lastIpcMemory: 'max(runner log heap MB, last subsampled memory.jsonl line); RSS a lower bound',
        exitCode: 'lost (in-memory process table of the stopped parent)', stderrTail: 'lost' } })
  }
  // The parent ran tasks strictly in order (concurrency 1): the ran tasks must be a prefix and every other task notRun.
  const ranIds = stage1.map(r => r.taskId)
  if (JSON.stringify(ranIds) !== JSON.stringify(tasks.slice(0, ranIds.length).map(t => t.taskId))) throw new Error('The ran tasks are not a prefix of the task order.')
  if (ranIds.length + notRun.length !== tasks.length) throw new Error('Ran + notRun is not every task.')
  const extraTaskFiles = notRun.filter(t => t.taskFileWritten)
  if (extraTaskFiles.length > 1 || (extraTaskFiles.length === 1 && extraTaskFiles[0].taskId !== notRun[0].taskId)) throw new Error('A notRun task file other than the next task in order.')

  const firstEnd = Date.parse(tasksEnded.endedAt) - tasksEnded.wallMs
  const stage1Conditions = { ...c2b2a.PHASE2C26B2C2B2A_STAGE1 }
  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
    stage1: stage1Conditions, tasksBudgetMs: c2b2a.PHASE2C26B2C2B2A_TASKS_BUDGET_MS, contextBudget: c2b2a.PHASE2C26B2C2B2A_CONTEXT_BUDGET, e1Targets: c2b2a.PHASE2C26B2C2B2A_TARGETS,
    expectedTasks: c2b2a.PHASE2C26B2C2B2A_EXPECTED_TASKS, maxCostCohorts: c2b2a.PHASE2C26B2C2B2A_MAX_COST_COHORTS, candidateSafetyCap: c2b2a.PHASE2C26B2C2B2A_CANDIDATE_SAFETY_CAP,
    capturePrefixes: c2b2a.PHASE2C26B2C2B2A_CAPTURE_PREFIXES, extentLabel: c2b2a.PHASE2C26B2C2B2A_EXTENT_LABEL, extent: { ...c2b2a.PHASE2C26B2C2B2A_EXTENT }, memorySampleIntervalMs: c2b2a.PHASE2C26B2C2B2A_MEMORY_SAMPLE_INTERVAL_MS,
    nodeYield: c2b2a.PHASE2C26B2C2B2A_NODE_YIELD, notRun: [...c2b2a.PHASE2C26B2C2B2A_NOT_RUN], registeredP1: c2b2a.PHASE2C26B2C2B2A_REGISTERED_P1,
    oracleGuidedPolicySelection: true, oracleGuidedTargetPopulation: true, contextOrderingUsesOracle: false, oracleReadBySearchChild: false, oracleMatchUsedForEarlyStop: false,
    oracleInformedCommonExtent: true, commonExtentForEveryTask: true, perTargetExtent: false, targetIndividualOracleExtentAsSearchInput: false, ladderRungsSearched: ['L2'],
    // The runner refuses uncommitted code without --allow-uncommitted; the formal launch passed no such option (see reconstruction.launch).
    repositoryHead: measuredHead, uncommittedBenchmarkCode: false, benchmarkCodeSha256,
    exportFileName: basename(paths.export), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    targetManifestFileName: basename(paths.targets), targetManifestSha256: sha256(rawTargets), targetManifestBytes: rawTargets.length, targetManifestSourceResultSha256: manifest.sourceResultSha256,
    smoke: null }
  const tasksChild = { process: { id: 'tasks', role: 'tasks', outcome: 'completed', wallMs: tasksEnded.wallMs, endedAt: tasksEnded.endedAt },
    recordFile: { file: 'tasks.record.json', bytes: tasksRecord.raw.length, sha256: sha256(tasksRecord.raw) }, childWallMs: tasksRecord.body.wallMs, scheduleMs: tasksRecord.body.scheduleMs,
    memory: tasksRecord.body.memory, researchMaxPlanSteps: tasksRecord.body.researchMaxPlanSteps, calculationContext: tasksRecord.body.calculationContext,
    rngEngineVersion: tasksRecord.body.rngEngineVersion, scheduleSummary: tasksRecord.body.result.scheduleSummary, construction: { valid: construction.valid, issues: construction.issues } }
  const out = { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2A: E1 P1 top-32 reservation contexts searched at the common L2 extent (Node Research run, raw, intentionally stopped; reconstructed post hoc)',
    measuredAt: new Date(firstEnd).toISOString(), environment, targetWeaponIds: manifest.targetWeaponIds,
    status: 'intentionally_stopped',
    intentionalStop: { stoppedAt, reason: stopReason, boundary: `after the outcome line of ${ranIds.at(-1)} (the running child ended by itself first); the parent runner was killed before it started another child`,
      ranTasks: ranIds.length, notRunTasks: notRun.length, notRunTaskIds: notRun.map(t => t.taskId),
      taskFileWrittenWithoutChild: extraTaskFiles.map(t => t.taskId), noRetry: true, conditionsUnchanged: true },
    reconstruction: { script: 'scripts/reconstruct-planner-global-phase2c26b2c2b2a-partial-raw.mjs', postHoc: true, childRecordsModified: false, searchRun: false,
      runDir: basename(resolve(paths.runDir)), runDirFiles: inventory.length, runDirInventorySha256, log: { file: basename(paths.log), bytes: Buffer.byteLength(logText), sha256: sha256(logText) },
      launch: 'node scripts/run-planner-global-phase2c26b2c2b2a.mjs --export <Export> --targets <manifest> --run-dir .local/c2b2a-formal.run --output .local/PLANNER_GLOBAL_PHASE2C26B2C2B2A_RAW.json.local (no --allow-uncommitted / smoke option), detached process from a clean working tree at the measured HEAD',
      lostFields: ['processes (the parent in-memory process table)', 'failed-child exit codes / stderr tails'], environmentRecomputed: 'host / Node / module constants recomputed at reconstruction; benchmarkCodeSha256 from the measured HEAD git objects by the runner rule' },
    tasksChild, tasks, stage1, notRun, processes: null, wallMs: Date.parse(stoppedAt) - firstEnd }
  const text = JSON.stringify(out, null, 2) + '\n'
  await writeFile(paths.output, text, { flag: 'wx' })
  const count = o => stage1.filter(r => r.process.outcome === o).length
  console.log(JSON.stringify({ output: resolve(paths.output), sha256: sha256(text), benchmarkCodeSha256, planned: tasks.length, ran: ranIds.length, completed: count('completed'), timeout: count('timeout'),
    outOfMemory: count('out_of_memory'), processFailure: count('process_failure'), notRun: notRun.length, runDirFiles: inventory.length, runDirInventorySha256, taskFileWrittenWithoutChild: extraTaskFiles.map(t => t.taskId), runDirExists: existsSync(paths.runDir) }, null, 2))
} finally {
  await server.close()
}
