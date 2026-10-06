// Issue #154 Phase 2-C2.6-B2-C2B2K Research only (an ORACLE-GUIDED DIAGNOSTIC, declared): the B2-C2B2E time-bound Target that timed
// out at 60 minutes / 12 GB, searched again on the current optimized main (B2-C2B2I + B2-C2B2J adopted) in B2-C2B2E's exact Search
// input (its B2-C1 P1 first compatible context at its tight extent) under B2-C2B2E's exact execution conditions: 60 minutes, a
// 12,288 MB child heap, concurrency 1, a fresh child, no retry, no fallback, and no instrumentation at all (no section observer, no
// CPU profiler, no allocation profiler, no heap snapshot). The probe and its expected Search input identity come from the probe
// manifest; the Search child never reads an oracle, a RESULT, a B2-C2B2E / B2-C2B2I / B2-C2B2J measurement or an expected outcome.
//
// Parent (default role):
//   0. reads the Export and the probe manifest (--probes, made by prepare-planner-global-phase2c26b2c2b2k-probes.mjs) and computes its
//      launch observation (HEAD, uncommitted benchmark code, benchmark code SHA-256, Export / manifest SHA-256). Parent-side only (the
//      Search child never reads them), it reads the committed B2-C2B2E / B2-C2B2I / B2-C2B2J RESULTs (--b2c2b2e-result,
//      --b2c2b2i-result, --b2c2b2j-result), which must be the registered formal authorities and must re-derive the manifest exactly,
//      and hashes the local B2-C2B2E raw evidence (--b2c2b2e-raw, --b2c2b2e-run-dir, --b2c2b2e-probes): each must be the file the
//      B2-C2B2E RESULT recorded. It audits the Production calculation sources by git (working tree included): none changed since the
//      base main (this phase changes none), exactly the adopted optimizations' files since B2-C2B2E's measured HEAD, each byte-identical
//      to its formal measured file. Any mismatch: no formal run;
//   1. START ATTESTATION: writes start-attestation.json into the new run dir ONCE (`wx`, then read-only) BEFORE any child process,
//      reads it back and, for a formal launch, verifies it (verifyPhase2C26B2C2B2KStartAttestation());
//   2. `tasks` child: derivePhase2C26B2C1Schedule() over the Export, then buildPhase2C26B2C2B2KTasks() (B2-C2B2E's construction, gated
//      by the expected B2-C2B2E task identity); 1 task or no Search;
//   3. Stage 1: the task once in a fresh child, heap 12,288 MB, concurrency 1, 60-minute budget, no retry and no fallback - a 60-minute
//      timeout stays a timeout and a 12 GB out-of-memory stays out-of-memory. The child is B2-C2B2E's: it receives the task only,
//      re-derives the schedule from the Export, checks the task against its own P1 rank row, rebuilds the context, replaces its extent
//      by the tight one and runs runPhase2C26B2C2B2KTask() (= B2-C2B2E's = B2-C2B2D's, the same function object) with the C4C capture.
// A child failure (timeout, out of memory, any other failure) is recorded as that failure, never as "no Candidate". Every child start
// and end is logged and appended to processes.jsonl in the run dir.
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { existsSync, lstatSync, appendFileSync, readFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { cpus, totalmem, freemem, release, platform, arch } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const role = option('--role') ?? 'parent'
const exportPath = option('--export')
if (!exportPath) {
  throw new Error('Usage: node scripts/run-planner-global-phase2c26b2c2b2k.mjs --export <external.json> --probes <probe manifest .json.local> --b2c2b2e-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2E_RESULT.json --b2c2b2i-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2I_RESULT.json --b2c2b2j-result docs/PLANNER_GLOBAL_PHASE2C26B2C2B2J_RESULT.json --b2c2b2e-raw <B2-C2B2E raw .json.local> --b2c2b2e-run-dir <B2-C2B2E run dir> --b2c2b2e-probes <B2-C2B2E probe manifest .json.local> --run-dir <new dir .local> --output <new.json.local> [--allow-uncommitted --smoke-budget-ms N]')
}
const SCRIPT_PATH = 'scripts/run-planner-global-phase2c26b2c2b2k.mjs'
const write = (path, value, pretty = true) => writeFile(path, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n', { flag: 'wx' })
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const gitBuffer = (...a) => execFileSync('git', a, { maxBuffer: 1 << 28 })
const sha256 = value => createHash('sha256').update(value).digest('hex')
const lines = text => text.split(/\r?\n/).filter(Boolean)

async function loadModules(server) {
  return {
    k: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2K.ts'),
    b2c1: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C1.ts'),
    c26a: await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26A.ts'),
    hashing: await server.ssrLoadModule('/src/domain/models/hashing.ts'),
    research: await server.ssrLoadModule('/src/benchmarks/plannerGlobalOptimizationResearch.ts'),
    runner: await server.ssrLoadModule('/src/benchmarks/plannerGlobalBrowserBenchmarkRunner.ts'),
    ProductionRngEngine: (await server.ssrLoadModule('/src/domain/rng/production/productionRngEngine.ts')).ProductionRngEngine,
  }
}
const createLoader = () => createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })

if (role !== 'parent') {
  // ------------------------------------------------------------------ child (B2-C2B2E's, with B2-C2B2K's re-exports of the same functions)
  const taskPath = option('--task'), recordPath = option('--record')
  if (!recordPath || !taskPath) throw new Error('A child needs --task and --record.')
  const server = await createLoader()
  const { k, b2c1, c26a, hashing, research, runner, ProductionRngEngine } = await loadModules(server)
  const tracker = c26a.createPhase2C26AMemoryTracker()
  let yields = 0
  const sample = () => {
    const maxima = tracker.sample(process.memoryUsage())
    process.send?.({ type: 'memory', maxima, yields })
  }
  const timer = setInterval(sample, k.PHASE2C26B2C2B2K_MEMORY_SAMPLE_INTERVAL_MS)
  try {
    sample()
    const task = JSON.parse((await readFile(taskPath)).toString('utf8'))
    const started = performance.now()
    const input = research.globalResearchInputFromExport(JSON.parse((await readFile(exportPath)).toString('utf8')), runner.PHASE2A_RESEARCH_MAX_PLAN_STEPS)
    const engine = new ProductionRngEngine()
    const schedule = b2c1.derivePhase2C26B2C1Schedule(input, research.globalResearchDependencies(engine))
    const scheduleMs = performance.now() - started
    let result
    if (role === 'tasks') {
      // Task construction only: no Search.
      const construction = k.buildPhase2C26B2C2B2KTasks(schedule, { probes: task.probes, expectedTaskIdentities: task.expectedTaskIdentities })
      result = { construction,
        scheduleSummary: { policies: schedule.policies, extent: schedule.extent, origins: schedule.origins, checks: schedule.checks, snapshotChecks: schedule.snapshot.checks,
          originDigest: schedule.snapshot.originDigest, targets: schedule.targets.length, contexts: schedule.contexts.length, contextsDigest: sha256(hashing.stableStringify(schedule.contexts)),
          targetContexts: task.probes.map(p => ({ targetWeaponId: p.targetWeaponId, contexts: schedule.targets.find(t => t.targetWeaponId === p.targetWeaponId)?.contexts ?? null })) } }
    } else if (role === 'search') {
      result = await k.runPhase2C26B2C2B2KTask(input, schedule, task, engine, { yieldControl: () => new Promise(done => { yields += 1; setImmediate(done) }) })
    } else throw new Error(`Unknown role ${role}.`)
    const wallMs = performance.now() - started
    sample()
    const maxima = tracker.current()
    await write(recordPath, { role, task, wallMs, scheduleMs, yields,
      memory: { samples: maxima.samples, sampledMaxHeapUsedBytes: maxima.maxHeapUsedBytes, sampledMaxRssBytes: maxima.maxRssBytes,
        maxRssKiB: process.resourceUsage().maxRSS, heapSizeLimitBytes: getHeapStatistics().heap_size_limit },
      researchMaxPlanSteps: input.options.maxPlanSteps, calculationContext: input.calculationContext, rngEngineVersion: engine.version, result }, false)
  } finally {
    clearInterval(timer)
    await server.close()
  }
  process.exit(0)
}

// -------------------------------------------------------------------- parent
const runDir = option('--run-dir'), outputPath = option('--output'), probesPath = option('--probes')
const authorityPaths = { e: option('--b2c2b2e-result'), i: option('--b2c2b2i-result'), j: option('--b2c2b2j-result') }
const evidencePaths = { run: option('--b2c2b2e-raw'), runDir: option('--b2c2b2e-run-dir'), probeManifest: option('--b2c2b2e-probes') }
if (!runDir || !outputPath || !probesPath || Object.values(authorityPaths).some(v => !v) || Object.values(evidencePaths).some(v => !v)) {
  throw new Error('The parent needs --probes, --b2c2b2e-result, --b2c2b2i-result, --b2c2b2j-result, --b2c2b2e-raw, --b2c2b2e-run-dir, --b2c2b2e-probes, --run-dir and --output.')
}
if (resolve(exportPath).toLowerCase() === resolve(outputPath).toLowerCase()) throw new Error('Output must not overwrite the Export.')
if (lstatSync(outputPath, { throwIfNoEntry: false }) !== undefined) throw new Error(`Output already exists: ${resolve(outputPath)}`)
if (existsSync(runDir)) throw new Error(`Run dir already exists: ${resolve(runDir)}`)
const allowUncommitted = args.includes('--allow-uncommitted')
// Non-formal smoke only: an optional shorter budget (the one task always runs).
const smokeBudgetMs = option('--smoke-budget-ms') === undefined ? null : Number(option('--smoke-budget-ms'))
const smoke = smokeBudgetMs !== null
if (smoke && !allowUncommitted) throw new Error('--smoke-budget-ms is a non-formal smoke option and needs --allow-uncommitted.')

// The launch observation, computed by the runner itself before anything runs.
const codePaths = ['src', 'scripts', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
const uncommitted = Boolean(git('diff', 'HEAD', '--', ...codePaths) || git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
if (uncommitted && !allowUncommitted) throw new Error('Commit ALL benchmark code before a formal measurement (or pass --allow-uncommitted for a non-formal smoke).')
const repositoryHead = git('rev-parse', 'HEAD')
const codeHash = createHash('sha256')
for (const file of lines(git('ls-files', '--', ...codePaths))) { codeHash.update(file + '\0'); codeHash.update(await readFile(file)); codeHash.update('\0') }
const benchmarkCodeSha256 = codeHash.digest('hex')
const rawExport = await readFile(exportPath)
const rawProbes = await readFile(probesPath)
const rawAuthority = Object.fromEntries(await Promise.all(Object.entries(authorityPaths).map(async ([key, path]) => [key, await readFile(path)])))

/** The machine at launch (observation only): other Node processes and the CPU busy share over one second. */
async function machineObservation() {
  let otherNodeProcesses = null
  try {
    const list = platform() === 'win32' ? execFileSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
      : execFileSync('ps', ['-C', 'node', '-o', 'pid='], { encoding: 'utf8' })
    otherNodeProcesses = lines(list).filter(line => /node/i.test(line) || /^\s*\d+\s*$/.test(line)).length - 1
  } catch { otherNodeProcesses = null }
  const times = () => cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a }, { busy: 0, all: 0 })
  const a = times()
  await new Promise(done => setTimeout(done, 1000))
  const b = times()
  const cpuBusyShare = b.all > a.all ? (b.busy - a.busy) / (b.all - a.all) : null
  return { freeMemoryBytes: freemem(), totalMemoryBytes: totalmem(), otherNodeProcesses, cpuBusyShare }
}

const server = await createLoader()
try {
  const { k, c26a, ProductionRngEngine } = await loadModules(server)
  const kTargets = await server.ssrLoadModule('/src/benchmarks/plannerGlobalPhase2C26B2C2B2KTargets.ts')
  // 0. The probe manifest (the probe and its expected Search input identity only) and the Export it names.
  const parsed = k.parsePhase2C26B2C2B2KProbeManifest(JSON.parse(rawProbes.toString('utf8')))
  if (!parsed.valid) throw new Error(`The probe manifest is not valid: ${parsed.issues.join('; ')}`)
  const manifest = parsed.manifest
  if (sha256(rawExport) !== manifest.exportSha256) throw new Error('The Export read is not the one the probe manifest names.')
  const targetWeaponIds = manifest.probes.map(p => p.targetWeaponId)
  // 0b. The authorities (the parent only; the Search child never reads them): registered, formal, and re-deriving the manifest exactly.
  const e = kTargets.parsePhase2C26B2C2B2KB2C2B2EAuthority(JSON.parse(rawAuthority.e.toString('utf8')), sha256(rawAuthority.e))
  if (!e.valid) throw new Error(`The B2-C2B2E RESULT is not the registered before authority: ${e.issues.join('; ')}`)
  const i = kTargets.parsePhase2C26B2C2B2KB2C2B2IAuthority(JSON.parse(rawAuthority.i.toString('utf8')), sha256(rawAuthority.i))
  if (!i.valid) throw new Error(`The B2-C2B2I RESULT is not the registered authority: ${i.issues.join('; ')}`)
  const j = kTargets.parsePhase2C26B2C2B2KB2C2B2JAuthority(JSON.parse(rawAuthority.j.toString('utf8')), sha256(rawAuthority.j))
  if (!j.valid) throw new Error(`The B2-C2B2J RESULT is not the registered authority: ${j.issues.join('; ')}`)
  const expectedManifest = kTargets.phase2c26b2c2b2kProbeManifest(e, i.authority, j.authority)
  if (JSON.stringify(expectedManifest) !== JSON.stringify(manifest)) throw new Error('The probe manifest is not the one the authorities re-derive.')
  const adoptedOptimizations = kTargets.phase2c26b2c2b2kAdoptedOptimizations(i.authority, j.authority)
  // 0c. The B2-C2B2E raw evidence: each local file must be the one the B2-C2B2E RESULT recorded.
  const evidenceLocal = {}
  const evidenceIssues = []
  for (const name of kTargets.PHASE2C26B2C2B2K_B2C2B2E_EVIDENCE) {
    const recorded = e.facts.evidence[name]
    const path = name === 'run' ? evidencePaths.run : name === 'probeManifest' ? evidencePaths.probeManifest : join(evidencePaths.runDir, recorded.file)
    if (basename(path) !== recorded.file) evidenceIssues.push(`${name}: the file name ${basename(path)} is not the recorded ${recorded.file}`)
    const local = existsSync(path) ? sha256(readFileSync(path)) : null
    evidenceLocal[name] = { file: basename(path), sha256: local }
    if (local !== recorded.sha256) evidenceIssues.push(`${name}: the local file SHA-256 ${local} is not the recorded ${recorded.sha256}`)
  }
  if (evidenceIssues.length > 0 && !smoke) throw new Error(`The B2-C2B2E raw evidence is not the recorded one; no formal run: ${evidenceIssues.join('; ')}`)
  // 0d. The Production calculation source audit (git, working tree included).
  const b2c2b2eMeasuredHead = e.authority.measuredHead
  const baseMain = k.PHASE2C26B2C2B2K_BASE_MAIN.sha
  let baseMainIsAncestor = true
  try { execFileSync('git', ['merge-base', '--is-ancestor', baseMain, 'HEAD']) } catch { baseMainIsAncestor = false }
  const untracked = lines(git('ls-files', '--others', '--exclude-standard', '--', ...codePaths))
  const productionChangedSinceB2C2B2E = kTargets.phase2c26b2c2b2kProductionChangedFiles([...lines(git('diff', '--name-only', b2c2b2eMeasuredHead, '--', ...codePaths)), ...untracked])
  const productionChangedSinceBaseMain = kTargets.phase2c26b2c2b2kProductionChangedFiles([...lines(git('diff', '--name-only', baseMain, '--', ...codePaths)), ...untracked])
  const forkPoint = git('merge-base', b2c2b2eMeasuredHead, baseMain)
  const mainCommits = lines(git('log', '--first-parent', '--reverse', '--format=%H%x09%s', `${forkPoint}..${baseMain}`)).map(line => {
    const [sha, ...subject] = line.split('\t')
    return { sha, subject: subject.join('\t'), productionChangedFiles: kTargets.phase2c26b2c2b2kProductionChangedFiles(lines(git('diff-tree', '--no-commit-id', '--name-only', '-r', sha))) }
  })
  const optimizedFilesEqualMeasured = kTargets.phase2c26b2c2b2kOptimizedFileHeads(adoptedOptimizations).map(({ file, measuredHead }) => ({ file, measuredHead,
    equal: existsSync(file) && sha256(gitBuffer('show', `${measuredHead}:${file}`)) === sha256(readFileSync(file)) }))
  const productionAudit = { b2c2b2eMeasuredHead, productionChangedSinceB2C2B2E, adoptedOptimizationFiles: [...new Set(adoptedOptimizations.flatMap(o => o.files))].sort(),
    productionChangedSinceBaseMain, baseMainIsAncestor, mainCommits, optimizedFilesEqualMeasured }
  const auditIssues = kTargets.phase2c26b2c2b2kProductionAuditIssues(productionAudit, adoptedOptimizations, b2c2b2eMeasuredHead)
  if (auditIssues.length > 0 && !smoke) throw new Error(`The Production audit fails; no formal run: ${auditIssues.join('; ')}`)
  const machine = await machineObservation()

  // 1. The start attestation: written once, read-only, before any child process.
  await mkdir(runDir, { recursive: true })
  const attestationPath = join(runDir, k.PHASE2C26B2C2B2K_START_ATTESTATION_FILE)
  const smokeOptions = smoke ? { budgetMs: smokeBudgetMs } : null
  const stage1Conditions = { ...k.PHASE2C26B2C2B2K_STAGE1, budgetMs: smokeBudgetMs ?? k.PHASE2C26B2C2B2K_STAGE1.budgetMs }
  const attestation = k.phase2c26b2c2b2kStartAttestationBody({ createdAt: new Date().toISOString(), runnerScript: SCRIPT_PATH, node: process.version, repositoryHead,
    uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256, exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length,
    probeManifestFileName: basename(probesPath), probeManifestSha256: sha256(rawProbes), b2c2b2eResultSha256: sha256(rawAuthority.e), b2c2b2iResultSha256: sha256(rawAuthority.i),
    b2c2b2jResultSha256: sha256(rawAuthority.j), b2c2b2eEvidence: evidenceLocal, adoptedOptimizations, productionAudit, targetWeaponIds, probes: manifest.probes,
    expectedTaskIdentities: manifest.expectedTaskIdentities, machine, stage1: stage1Conditions, smoke: smokeOptions })
  await write(attestationPath, attestation)
  await chmod(attestationPath, 0o444)
  const attestationRaw = await readFile(attestationPath)
  if (JSON.stringify(JSON.parse(attestationRaw.toString('utf8'))) !== JSON.stringify(attestation)) throw new Error('The start attestation read back is not the one written.')
  if (!smoke && !uncommitted) {
    const check = k.verifyPhase2C26B2C2B2KStartAttestation(JSON.parse(attestationRaw.toString('utf8')), { repositoryHead, benchmarkCodeSha256, exportSha256: sha256(rawExport),
      probeManifestSha256: sha256(rawProbes), b2c2b2eResultSha256: kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2E.resultSha256, b2c2b2iResultSha256: kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2I.resultSha256,
      b2c2b2jResultSha256: kTargets.PHASE2C26B2C2B2K_REGISTERED_B2C2B2J.resultSha256, b2c2b2eEvidence: e.facts.evidence, adoptedOptimizations, b2c2b2eMeasuredHead,
      probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities, firstChildStartedAt: null })
    if (!check.verified) throw new Error(`The start attestation does not verify: ${check.issues.join('; ')}`)
  }
  const launchAttestation = { file: k.PHASE2C26B2C2B2K_START_ATTESTATION_FILE, bytes: attestationRaw.length, sha256: sha256(attestationRaw), createdAt: attestation.createdAt }
  console.log(`${attestation.createdAt} ATTESTED ${launchAttestation.file} sha256=${launchAttestation.sha256} head=${repositoryHead} uncommitted=${uncommitted} smoke=${smoke} production=${productionChangedSinceBaseMain.join(',') || 'none'} sinceB2C2B2E=${productionChangedSinceB2C2B2E.join(',')} free=${(machine.freeMemoryBytes / 2 ** 30).toFixed(1)}GiB cpu=${machine.cpuBusyShare === null ? 'n/a' : (machine.cpuBusyShare * 100).toFixed(0) + '%'} node=${machine.otherNodeProcesses}`)

  const processes = []
  const processesPath = join(runDir, 'processes.jsonl')
  const phaseStarted = performance.now()

  /** One fresh child. Resolves with its record (or null), its record file SHA-256, classified outcome and last IPC memory; never throws for a child failure. */
  const runChild = (id, childRole, task, { heapMb, budgetMs }) => new Promise(done => {
    const taskPath = join(runDir, `${id}.task.json`)
    const recordPath = join(runDir, `${id}.record.json`)
    const memoryPath = join(runDir, `${id}.memory.jsonl`)
    const nodeFlags = [`--max-old-space-size=${heapMb}`]
    const start = async () => {
      await write(taskPath, task)
      const childArgs = [...nodeFlags, SCRIPT_PATH, '--role', childRole, '--export', exportPath, '--record', recordPath, '--task', taskPath]
      const began = performance.now(), startedAt = new Date().toISOString()
      let stderrTail = '', timedOut = false, killedAtMs = null, lastMemory = null, lastYields = 0, memoryMessages = 0
      const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
      console.log(`${startedAt} START ${id} pid=${child.pid}`)
      // The budget is judged here, in the parent, never by the child.
      const timer = setTimeout(() => { timedOut = true; killedAtMs = performance.now() - began; child.kill('SIGKILL') }, budgetMs)
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-12000) })
      child.on('message', message => {
        if (message?.type !== 'memory') return
        memoryMessages += 1
        lastMemory = message.maxima
        lastYields = message.yields
        if (memoryMessages % 20 === 1) appendFileSync(memoryPath, JSON.stringify({ receivedAtMs: performance.now() - began, ...message }) + '\n')
      })
      child.once('exit', async (code, signal) => {
        clearTimeout(timer)
        const recordWritten = existsSync(recordPath)
        const outcome = c26a.classifyPhase2C26AChildExit({ code, signal, timedOut, stderrTail, recordWritten })
        const endedAt = new Date().toISOString()
        const entry = { id, role: childRole, outcome, exitCode: code, signal, timedOut, budgetMs, startedAt, endedAt, wallMs: performance.now() - began, killedAtMs, nodeFlags,
          lastIpcMemory: lastMemory, lastIpcYields: lastYields, memoryMessages, stderrTail: outcome === 'completed' ? null : stderrTail.slice(-4000) }
        processes.push(entry)
        const recordRaw = outcome === 'completed' ? await readFile(recordPath) : null
        const recordFile = recordRaw === null ? null : { file: basename(recordPath), bytes: recordRaw.length, sha256: sha256(recordRaw) }
        appendFileSync(processesPath, JSON.stringify({ ...entry, recordFile }) + '\n')
        const record = recordRaw === null ? null : JSON.parse(recordRaw.toString('utf8'))
        const s = record?.result?.status === 'searched' ? record.result.search : null
        const status = s ? ` ${s.termination} n=${s.candidates.length} costs=${s.capturedCosts.join('/')}${s.nextCostSentinel ? ` sentinel=${s.nextCostSentinel.deliveryIndex}@${s.nextCostSentinel.orderingKeys.estimatedOperationCount}` : ''}`
          : record?.result?.status ? ` ${record.result.status}` : ''
        console.log(`${endedAt} ${outcome.toUpperCase()} ${id}${status} ${(entry.wallMs / 1000).toFixed(1)}s heap<=${((lastMemory?.maxHeapUsedBytes ?? 0) / 2 ** 20).toFixed(0)}MB yields=${lastYields}`)
        done({ entry, record, recordFile })
      })
    }
    start()
  })

  const environment = { runtime: 'Node (Vite SSR loader, one fresh child process per task, NOT a Browser Worker)', node: process.version, v8: process.versions.v8,
    platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtLaunch: machine.freeMemoryBytes,
    machine, stage1: stage1Conditions, b2c2b2eStage1: { ...k.PHASE2C26B2C2B2K_B2C2B2E_STAGE1 }, changedStage1Fields: [...k.PHASE2C26B2C2B2K_CHANGED_STAGE1_FIELDS],
    tasksBudgetMs: k.PHASE2C26B2C2B2K_TASKS_BUDGET_MS, targets: k.PHASE2C26B2C2B2K_TARGETS, contextsPerTarget: k.PHASE2C26B2C2B2K_CONTEXTS_PER_TARGET,
    expectedTasks: k.PHASE2C26B2C2B2K_EXPECTED_TASKS, maxCostCohorts: k.PHASE2C26B2C2B2K_MAX_COST_COHORTS, candidateSafetyCap: k.PHASE2C26B2C2B2K_CANDIDATE_SAFETY_CAP,
    capturePrefixes: k.PHASE2C26B2C2B2K_CAPTURE_PREFIXES, population: k.PHASE2C26B2C2B2K_POPULATION, contextSelection: k.PHASE2C26B2C2B2K_CONTEXT_SELECTION.id,
    extentRule: k.PHASE2C26B2C2B2K_EXTENT_RULE.id, extentFloor: { ...k.PHASE2C26B2C2B2K_FLOOR_EXTENT }, extentCeiling: { ...k.PHASE2C26B2C2B2K_COMMON_L2_EXTENT }, probes: manifest.probes,
    expectedTaskIdentities: manifest.expectedTaskIdentities, memorySampleIntervalMs: k.PHASE2C26B2C2B2K_MEMORY_SAMPLE_INTERVAL_MS, nodeYield: k.PHASE2C26B2C2B2K_NODE_YIELD,
    instrumentation: { ...k.PHASE2C26B2C2B2K_INSTRUMENTATION }, notRun: [...k.PHASE2C26B2C2B2K_NOT_RUN], registeredP1: k.PHASE2C26B2C2B2K_REGISTERED_P1, ...k.PHASE2C26B2C2B2K_PROVENANCE_FLAGS,
    repositoryHead, uncommittedBenchmarkCode: uncommitted, benchmarkCodeSha256,
    exportFileName: basename(exportPath), exportSha256: sha256(rawExport), exportBytes: rawExport.length, rngEngineVersion: new ProductionRngEngine().version,
    probeManifestFileName: basename(probesPath), probeManifestSha256: sha256(rawProbes), probeManifestBytes: rawProbes.length,
    b2c2b2eResultSha256: sha256(rawAuthority.e), b2c2b2iResultSha256: sha256(rawAuthority.i), b2c2b2jResultSha256: sha256(rawAuthority.j), b2c2b2eEvidence: evidenceLocal,
    adoptedOptimizations, productionAudit, smoke: smokeOptions }
  const base = { phase: 'Issue #154 Phase 2-C2.6-B2-C2B2K: the B2-C2B2E time-bound Target, same Search input and execution conditions (60 minutes / 12 GB) on the optimized current main (oracle-guided diagnostic, Node Research run, raw)',
    measuredAt: attestation.createdAt, environment, launchAttestation, targetWeaponIds }

  // 2. Task construction (no Search). The child gets the probe and the expected identity only.
  const tasksRun = await runChild('tasks', 'tasks', { probes: manifest.probes, expectedTaskIdentities: manifest.expectedTaskIdentities },
    { heapMb: stage1Conditions.childHeapMb, budgetMs: k.PHASE2C26B2C2B2K_TASKS_BUDGET_MS })
  if (!tasksRun.record) {
    await write(outputPath, { ...base, status: 'tasks_failed', processes, wallMs: performance.now() - phaseStarted })
    throw new Error('The tasks child failed; no Search was run.')
  }
  const construction = tasksRun.record.result.construction
  const tasksChild = { process: tasksRun.entry, recordFile: tasksRun.recordFile, childWallMs: tasksRun.record.wallMs, scheduleMs: tasksRun.record.scheduleMs, memory: tasksRun.record.memory,
    researchMaxPlanSteps: tasksRun.record.researchMaxPlanSteps, calculationContext: tasksRun.record.calculationContext, rngEngineVersion: tasksRun.record.rngEngineVersion,
    scheduleSummary: tasksRun.record.result.scheduleSummary, construction: { valid: construction.valid, issues: construction.issues } }
  // Gate: exactly one task, at the probe's rank and tight extent, named by its B2-C2B2E task ID, with the B2-C2B2E Search input identity.
  const tasks = construction.tasks
  const gateIssues = [...construction.issues]
  if (tasks.length !== k.PHASE2C26B2C2B2K_EXPECTED_TASKS) gateIssues.push(`${tasks.length} tasks, not ${k.PHASE2C26B2C2B2K_EXPECTED_TASKS}`)
  manifest.probes.forEach((probe, index) => {
    const task = tasks[index]
    if (!task || task.taskId !== probe.b2c2b2dTaskId || task.targetWeaponId !== probe.targetWeaponId || task.contextRank !== probe.contextRank || JSON.stringify(task.extent) !== JSON.stringify(probe.extent)) gateIssues.push(`${probe.targetWeaponId}: the task is not the probe`)
  })
  console.log(`tasks: ${tasks.length}; gate ${gateIssues.length === 0 ? 'ok' : gateIssues.join('; ')}`)
  if (gateIssues.length > 0) {
    await write(outputPath, { ...base, status: 'task_construction_failed', gateIssues, tasksChild, processes, wallMs: performance.now() - phaseStarted })
    throw new Error(`Task construction failed; no Search was run: ${gateIssues.join('; ')}`)
  }

  // 3. Stage 1 (60 minutes, 12,288 MB, concurrency 1; no retry, no fallback, no instrumentation).
  const stage1 = []
  for (const task of tasks) {
    const run = await runChild(`stage1-${task.taskId}`, 'search', task, { heapMb: stage1Conditions.childHeapMb, budgetMs: stage1Conditions.budgetMs })
    const result = run.record?.result ?? null
    const outcome = k.phase2c26b2c2b2kTaskOutcome(task.taskId, run.entry.outcome, result)
    stage1.push({ taskId: task.taskId, task, outcome,
      process: { outcome: run.entry.outcome, wallMs: run.entry.wallMs, timedOut: run.entry.timedOut, budgetMs: run.entry.budgetMs, exitCode: run.entry.exitCode, stderrTail: run.entry.stderrTail,
        startedAt: run.entry.startedAt, endedAt: run.entry.endedAt },
      recordFile: run.recordFile, childWallMs: run.record?.wallMs ?? null, scheduleMs: run.record?.scheduleMs ?? null, yields: run.record?.yields ?? run.entry.lastIpcYields ?? null,
      memory: run.record?.memory ?? null, lastIpcMemory: run.entry.lastIpcMemory, calculationContext: run.record?.calculationContext ?? null,
      researchMaxPlanSteps: run.record?.researchMaxPlanSteps ?? null, rngEngineVersion: run.record?.rngEngineVersion ?? null,
      contextMismatchIssues: result?.status === 'context_mismatch' ? result.issues : null,
      capture: result?.status === 'searched' ? { termination: result.search.termination, candidateCount: result.search.candidates.length, capturedCosts: result.search.capturedCosts,
        captureComplete: result.search.captureComplete, safetyCapHit: result.search.safetyCapHit, elapsedMs: result.search.elapsedMs } : null })
  }

  const record = { ...base, status: 'completed', tasksChild, tasks, stage1, processes, wallMs: performance.now() - phaseStarted }
  await write(outputPath, record)
  console.log(JSON.stringify({ output: resolve(outputPath), tasks: tasks.length,
    stage1: stage1.map(r => ({ task: r.taskId, process: r.outcome.process, record: r.outcome.record, capture: r.capture, wallMs: r.process.wallMs, yields: r.yields })), wallMs: record.wallMs }, null, 2))
} finally {
  await server.close()
}
