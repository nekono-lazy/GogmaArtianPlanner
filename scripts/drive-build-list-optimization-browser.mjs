// Issue #260 PR-5A: the external CDP driver of the Production Build List optimization Browser measurement (benchmark only). It
// follows the committed plan (git show <measurement HEAD>:<plan document>): it launches Chrome with a dedicated scratch profile in the
// plan's Browser mode, opens the benchmark page (benchmark-build-list-optimization.html) of each session's origin, selects each slot's
// input (an Export through DOM.setFileInputFiles, never uploaded anywhere; a synthetic case through the page), runs every planned
// slot in plan order through the page's console API with the slot's exact options and the plan's bounds, saves the page's records
// after every run, observes the Worker targets (attach / detach, and the heap of a memory slot), the renderer processes' OS memory
// where the plan asks, the page storage counts of each session, and a lost page. It runs no calculation, parses no Export, compares
// nothing with an expected value and retries nothing.
//
// When a slot ends without a saved record (the driver's deadline, a lost page, an error after which the run's settlement is unknown),
// its page is closed - and its Worker with it - and the next slot runs on a new, re-verified page; the slot that ended so is recorded
// with its end and never run again (runBloDriverSessions(), buildListOptimizationBenchmarkDriverControl.ts).
//
//   node scripts/drive-build-list-optimization-browser.mjs --mode mechanics|measurement --measurement-head <40 hex> --plan <docs/...md>
//     --chrome <chrome executable> --profile <new dir> --out <new dir> [--export <file>] [--headless]
//     [--non-isolated-origin http://127.0.0.1:4181] [--isolated-origin http://127.0.0.1:4182] [--slot-deadline-ms <ms> (mechanics only)]
//
// The pages are served by `vite preview --config vite.benchmark.config.ts` from a benchmark build of the measurement HEAD (the
// isolated origin with BENCHMARK_CROSS_ORIGIN_ISOLATED=1). The driver refuses a page built from other code, on another origin or in
// another Browser mode than the plan's.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const PLAN_DOCS = ['docs/BUILD_LIST_OPTIMIZATION_BROWSER_MECHANICS_PLAN.md', 'docs/BUILD_LIST_OPTIMIZATION_BROWSER_MEASUREMENT_PLAN.md']
const PAGE_PATH = '/GogmaArtianPlanner/benchmark-build-list-optimization.html'
const ENVIRONMENT_ID = 'pc-windows-chrome'
const PORT = 9334
const RUN_INTERVAL_MS = 5_000
const START_IDLE_MS = 5_000
const HEAP_INTERVAL_MS = 500
const OS_INTERVAL_MS = 1_000
const SLOT_DEADLINE_MS = 30 * 60_000

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const mode = option('--mode'), head = option('--measurement-head'), planPath = option('--plan'), chromePath = option('--chrome')
const profile = option('--profile'), out = option('--out'), exportPath = option('--export')
const origins = { non_isolated: option('--non-isolated-origin') ?? 'http://127.0.0.1:4181', isolated: option('--isolated-origin') ?? 'http://127.0.0.1:4182' }
const headless = args.includes('--headless')
const launchMode = headless ? 'headless' : 'headed'
if (!['mechanics', 'measurement'].includes(mode) || !/^[0-9a-f]{40}$/.test(head ?? '') || !PLAN_DOCS.includes(planPath) || !chromePath || !profile || !out) {
  throw new Error('usage: --mode mechanics|measurement --measurement-head <sha> --plan <docs/...md> --chrome <exe> --profile <new dir> --out <new dir> [--export <file>] [--headless] [--slot-deadline-ms <ms>]')
}
// The deadline is the measurement's own (30 minutes); only a mechanics run may shorten it, to exercise the deadline path.
const deadlineOption = option('--slot-deadline-ms')
if (deadlineOption !== undefined && (mode !== 'mechanics' || !/^[1-9][0-9]*$/.test(deadlineOption))) throw new Error('--slot-deadline-ms is a positive integer of a mechanics run only.')
const slotDeadlineMs = deadlineOption === undefined ? SLOT_DEADLINE_MS : Number(deadlineOption)
if (existsSync(out) || existsSync(profile)) throw new Error('--out and --profile must be new directories.')
const sleep = ms => new Promise(done => setTimeout(done, ms))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const driverSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)))

// ------------------------------------------------------------------ the committed plan, the checkout and the shared modules
const git = (...values) => execFileSync('git', values, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
if (git('rev-parse', 'HEAD') !== head) throw new Error(`The checkout is not at the measurement HEAD ${head}.`)
if (git('status', '--porcelain', '--', 'src', 'scripts', 'docs', 'package.json', 'package-lock.json', 'vite.config.ts', 'vite.benchmark.config.ts') !== '') throw new Error('The checkout has uncommitted changes.')
const planBytes = execFileSync('git', ['show', `${head}:${planPath}`], { maxBuffer: 1 << 28 })
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
let control, planModule
try {
  control = await server.ssrLoadModule('/src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkDriverControl.ts')
  planModule = await server.ssrLoadModule('/src/benchmarks/buildListOptimization/buildListOptimizationBenchmarkPlan.ts')
} finally {
  await server.close()
}
const extracted = planModule.extractBloMeasurementPlan(planBytes.toString('utf8'))
const planIssues = extracted.issues.length > 0 ? extracted.issues : planModule.bloMeasurementPlanIssues(extracted.plan)
if (planIssues.length > 0) throw new Error(`The plan at ${head}:${planPath} is invalid: ${planIssues.join(' / ')}`)
const plan = extracted.plan
if (plan.planKind !== mode) throw new Error(`The plan is a ${plan.planKind} plan, not ${mode}.`)
if (mode === 'measurement' && (plan.status !== 'registered' || plan.approval.state !== 'owner_approved')) throw new Error('A measurement runs only on a registered, Owner-approved plan.')
const environment = plan.environments.find(entry => entry.environmentId === ENVIRONMENT_ID && entry.status === 'planned')
if (environment === undefined) throw new Error(`The plan has no planned ${ENVIRONMENT_ID} environment.`)
// The Browser mode: the plan decides, before Chrome is launched.
const modeIssue = control.bloDriverLaunchModeIssue(plan.planKind, environment.browserMode, launchMode)
if (modeIssue !== null) throw new Error(modeIssue)
const slots = [...environment.slots].sort((left, right) => left.order - right.order)
const sessions = []
for (const slot of slots) {
  const last = sessions.at(-1)
  if (last !== undefined && last.origin === slot.origin) last.slots.push(slot)
  else sessions.push({ sessionId: `s${sessions.length + 1}-${slot.origin}`, origin: slot.origin, slots: [slot] })
}
const exportBytes = exportPath === undefined ? null : readFileSync(exportPath)
for (const input of plan.inputs.filter(entry => entry.kind === 'export' && slots.some(slot => slot.inputId === entry.inputId))) {
  if (exportBytes === null) throw new Error(`The plan's input ${input.inputId} needs --export.`)
  if (exportBytes.length !== input.bytes || sha256(exportBytes) !== input.sha256) throw new Error(`The Export is not the plan's input ${input.inputId}.`)
}

mkdirSync(join(out, 'raw'), { recursive: true })
const logPath = join(out, 'driver.log')
const log = (...parts) => { const line = `${new Date().toISOString()} ${parts.join(' ')}`; appendFileSync(logPath, line + '\n'); console.log(line) }
log('START', mode, `head=${head}`, `driver=${driverSha256}`, `plan=${planPath}`, `browser=${launchMode}`, `deadline=${slotDeadlineMs}ms`, `sessions=${sessions.map(session => `${session.sessionId}:${session.slots.length}`).join(',')}`)

// ------------------------------------------------------------------ CDP
class Cdp {
  constructor(url) { this.url = url; this.nextId = 0; this.pending = new Map(); this.listeners = new Set(); this.closed = false }
  async open() {
    this.ws = new WebSocket(this.url)
    await new Promise((done, fail) => { this.ws.onopen = done; this.ws.onerror = fail })
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) { const entry = this.pending.get(message.id); this.pending.delete(message.id); entry?.(message); return }
      for (const listener of this.listeners) listener(message)
    }
    this.ws.onclose = () => { this.closed = true; for (const entry of this.pending.values()) entry({ error: { message: 'socket closed' } }); this.pending.clear() }
    return this
  }
  send(method, params = {}, { sessionId, timeoutMs = 120_000 } = {}) {
    return new Promise((done, fail) => {
      if (this.closed) { fail(new Error(`CDP ${method}: socket closed`)); return }
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); fail(new Error(`CDP ${method} timed out`)) }, timeoutMs)
      this.pending.set(id, message => { clearTimeout(timer); if (message.error) fail(new Error(`${method}: ${message.error.message}`)); else done(message.result) })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  close() { try { this.ws.close() } catch { /* closed */ } }
}

const windows = platform() === 'win32'
const cpuLoad = () => {
  if (!windows) return null
  try {
    return Number(execFileSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average'], { encoding: 'utf8' }).trim())
  } catch { return null }
}

// ------------------------------------------------------------------ Chrome
const flags = [`--user-data-dir=${resolve(profile)}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--window-size=1280,900', ...(headless ? ['--headless=new'] : ['--new-window'])]
const chrome = spawn(chromePath, [...flags, 'about:blank'], { detached: true, stdio: 'ignore' })
chrome.unref()
let version = null
for (let attempt = 0; attempt < 100 && version === null; attempt += 1) {
  try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { await sleep(200) }
}
if (version === null) throw new Error('Chrome did not open its DevTools endpoint.')
log('CHROME', version.Browser, launchMode)
const browser = await new Cdp(version.webSocketDebuggerUrl).open()
const crashDir = join(profile, 'Crashpad', 'reports')
const dumps = () => (existsSync(crashDir) ? readdirSync(crashDir).filter(name => name.endsWith('.dmp')) : [])
/** The `v8-oom-location` crash annotation of a dump, or null (only explicit OOM evidence is called out of memory). */
const oomEvidence = name => {
  try {
    const bytes = readFileSync(join(crashDir, name))
    const key = Buffer.from('v8-oom-location\0')
    const at = bytes.indexOf(key)
    if (at < 0) return null
    for (let pad = 0; pad <= 8; pad += 1) {
      const lengthAt = at + key.length + pad
      const length = bytes.readUInt32LE(lengthAt)
      if (length > 0 && length < 512) {
        const value = bytes.subarray(lengthAt + 4, lengthAt + 4 + length).toString('latin1')
        if (/^[\x20-\x7e]+$/.test(value)) return `crashpad ${name}: v8-oom-location=${value}`
      }
    }
    return `crashpad ${name}: v8-oom-location present`
  } catch { return null }
}

const record = {
  kind: 'build-list-optimization-browser-driver-record', revision: 2, measurementHead: head, plan: { path: planPath, sha256: sha256(planBytes) }, driverSha256,
  launcher: { browser: 'chrome', version: version.Browser, headless, mode: launchMode, planBrowserMode: environment.browserMode, flags: flags.filter(flag => !flag.startsWith('--user-data-dir') && !flag.startsWith('--remote-debugging-port')) },
  slotDeadlineMs,
  machine: { cpuModel: cpus()[0]?.model?.trim() ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), os: `${platform()} ${release()} ${arch()}` },
  sessions: [], slots: [], pageRestarts: [],
}
const saveRecord = (name, flag) => writeFileSync(join(out, name), JSON.stringify(record, null, 2) + '\n', flag === undefined ? undefined : { flag })
const sync = result => { record.sessions = result.sessions; record.slots = result.slots; record.pageRestarts = result.pageRestarts; saveRecord('driver.partial.json') }

// ------------------------------------------------------------------ the page port of the slot control
/** Opens a page of the session's origin and verifies it: the benchmark build of the HEAD, a secure context, the origin's isolation, the launched Browser mode. */
async function openPage(session, pageIndex) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: false })
  const page = await new Cdp(`ws://127.0.0.1:${PORT}/devtools/page/${targetId}`).open()
  const state = { targetId, page, pageIndex, crashed: false, workers: [] }
  page.on(message => {
    if (message.method === 'Inspector.targetCrashed') { state.crashed = true; log('PAGE', `#${pageIndex}`, 'Inspector.targetCrashed') }
    if (message.method === 'Runtime.exceptionThrown') log('PAGE', `#${pageIndex}`, 'exception', message.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? message.params.exceptionDetails?.text)
    if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'worker') {
      state.workers.push({ sessionId: message.params.sessionId, target: `worker-${state.workers.length + 1}`, attachedAtEpochMs: Date.now(), detachedAtEpochMs: null })
    }
    if (message.method === 'Target.detachedFromTarget') {
      const worker = state.workers.find(entry => entry.sessionId === message.params.sessionId)
      if (worker && worker.detachedAtEpochMs === null) worker.detachedAtEpochMs = Date.now()
    }
  })
  const evaluate = async (expression, timeoutMs = 120_000) => {
    const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, { timeoutMs })
    if (result.exceptionDetails) throw new Error(`evaluate: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    return result.result.value
  }
  state.evaluate = evaluate
  try {
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Inspector.enable'); await page.send('DOM.enable')
    await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
    await page.send('Page.navigate', { url: `${origins[session.origin]}${PAGE_PATH}` })
    let ready = false
    for (let attempt = 0; attempt < 300 && !ready; attempt += 1) {
      ready = await evaluate('typeof globalThis.buildListOptimizationBenchmark === "object"').catch(() => false)
      if (!ready) await sleep(100)
    }
    if (!ready) throw new Error('The benchmark page did not expose its console API.')
    if (!headless) await page.send('Page.bringToFront')
    const environmentValue = await evaluate('globalThis.buildListOptimizationBenchmark.environment()')
    const build = environmentValue.build
    if (build?.commit !== head || build?.uncommittedBenchmarkCode !== false) throw new Error(`The page was built from ${build?.commit} (uncommitted ${build?.uncommittedBenchmarkCode}), not ${head}.`)
    if (environmentValue.isSecureContext !== true || environmentValue.crossOriginIsolated !== (session.origin === 'isolated')) throw new Error(`The page environment is ${environmentValue.isSecureContext} / ${environmentValue.crossOriginIsolated}.`)
    const pageModeIssue = control.bloPageBrowserModeIssue(environmentValue.userAgent ?? null, launchMode)
    if (pageModeIssue !== null) throw new Error(pageModeIssue)
    await sleep(START_IDLE_MS)
    return state
  } catch (error) {
    await closePage(state)
    throw error
  }
}

/** Closes the page target (its renderer and Workers go with it). Never throws. */
async function closePage(state) {
  try { await browser.send('Target.closeTarget', { targetId: state.targetId }, { timeoutMs: 10_000 }) } catch { /* gone */ }
  state.page.close()
}

const readStorage = state => state.evaluate(`(async () => ({
  indexedDbDatabases: (await indexedDB.databases()).length, localStorageKeys: localStorage.length, sessionStorageKeys: sessionStorage.length,
  cacheKeys: typeof caches === 'object' ? (await caches.keys()).length : null, serviceWorkerRegistrations: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : null,
}))()`).catch(error => { log('STORAGE', 'failed', error.message); return null })

async function selectInput(state, input) {
  if (input.kind === 'synthetic') return state.evaluate(`globalThis.buildListOptimizationBenchmark.useSynthetic(${JSON.stringify(input.caseId)})`)
  const current = await state.evaluate('globalThis.buildListOptimizationBenchmark.inputInfo()')
  if (current?.kind === 'export' && current.sha256 === input.sha256) return current
  const { root } = await state.page.send('DOM.getDocument', { depth: -1 })
  const { nodeId } = await state.page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#blo-export-file' })
  await state.page.send('DOM.setFileInputFiles', { nodeId, files: [resolve(exportPath)] })
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const info = await state.evaluate('globalThis.buildListOptimizationBenchmark.inputInfo()')
    if (info?.kind === 'export' && info.fileName === input.fileName) {
      if (info.bytes !== input.bytes || info.sha256 !== input.sha256) throw new Error('The page observed another Export.')
      return info
    }
    await sleep(100)
  }
  throw new Error('The page never observed the Export.')
}

function heapSampler(state, firstWorker) {
  const samples = []
  let errors = 0
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      for (const worker of state.workers.slice(firstWorker)) {
        if (worker.detachedAtEpochMs !== null) continue
        try {
          const usage = await state.page.send('Runtime.getHeapUsage', {}, { sessionId: worker.sessionId, timeoutMs: 2_000 })
          samples.push({ atEpochMs: Date.now(), target: worker.target, usedSize: usage.usedSize, totalSize: usage.totalSize })
        } catch { errors += 1 }
      }
      await sleep(HEAP_INTERVAL_MS)
    }
  })()
  return async () => { stopped = true; await loop; return { samples, errors } }
}

async function osSampler() {
  if (!windows) return async () => null
  const { processInfo } = await browser.send('SystemInfo.getProcessInfo').catch(() => ({ processInfo: [] }))
  const ids = processInfo.filter(entry => entry.type === 'renderer').map(entry => entry.id)
  if (ids.length === 0) return async () => null
  const file = join(out, `os-memory-${Date.now()}.csv`)
  const script = `$ids=@(${ids.join(',')}); while ($true) { $p=@(Get-Process -Id $ids -ErrorAction SilentlyContinue); if ($p.Count -gt 0) { $m=$p | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 1; Add-Content -Path '${file.replace(/'/g, "''")}' -Value ("{0},{1},{2},{3}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(),$m.PrivateMemorySize64,$m.WorkingSet64,$p.Count) }; Start-Sleep -Milliseconds ${OS_INTERVAL_MS} }`
  const child = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
  return async () => {
    child.kill()
    await sleep(300)
    const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean) : []
    return { intervalMs: OS_INTERVAL_MS, samples: lines.map(line => { const [atEpochMs, privateBytes, workingSetBytes, processCount] = line.split(',').map(Number); return { atEpochMs, privateBytes, workingSetBytes, processCount } }) }
  }
}

let rawIndex = 0
/** Runs one slot on the page and saves its record. Returns the slot's end; throws when the run's settlement is unknown. */
async function runSlot(state, slot, entry) {
  entry.cpuLoadPercentBefore = cpuLoad()
  entry.cdpWorkerHeap = null
  entry.osRendererMemory = null
  await sleep(RUN_INTERVAL_MS)
  if (!headless) await state.page.send('Page.bringToFront').catch(() => undefined)
  const input = plan.inputs.find(candidate => candidate.inputId === slot.inputId)
  const boundsSet = plan.boundsSets.find(candidate => candidate.boundsId === slot.boundsId)
  const identity = await selectInput(state, input)
  const spec = {
    slotId: slot.slotId, purpose: slot.purpose, planned: true, inputId: slot.inputId, boundsId: slot.boundsId, bounds: boundsSet.bounds,
    cancelTrigger: slot.cancelTrigger, faultInjection: slot.faultInjection, memory: slot.memory,
  }
  const startedAt = Date.now()
  entry.startedAt = new Date(startedAt).toISOString()
  const dumpsBefore = new Set(dumps())
  const firstWorker = state.workers.length
  const stopHeap = slot.memory?.cdpWorkerHeap ? heapSampler(state, firstWorker) : null
  const stopOs = slot.memory?.osProcessMemory ? await osSampler() : null
  log('SLOT', slot.slotId, slot.purpose, `page=#${state.pageIndex}`, `input=${slot.inputId}`, `bounds=${slot.boundsId}`, `cpu=${entry.cpuLoadPercentBefore}%`)
  let result = null
  try {
    await state.evaluate(`(() => { window.__blo = { done: false, value: null }; globalThis.buildListOptimizationBenchmark.runSlot(${JSON.stringify(spec)}, { inputSha256: ${JSON.stringify(identity.sha256)} }).then(value => { window.__blo = { done: true, value: { ok: true, ...value } } }, error => { window.__blo = { done: true, value: { ok: false, error: String(error && error.message || error) } } }); return true })()`)
    while (Date.now() < startedAt + slotDeadlineMs && !state.crashed) {
      await sleep(Math.min(1_000, slotDeadlineMs))
      const status = await state.evaluate('window.__blo', 30_000).catch(error => ({ error: error.message }))
      if (status?.error) { if (state.page.closed || state.crashed) break; continue }
      if (status?.done) { result = status.value; break }
    }
  } finally {
    entry.endedAt = new Date().toISOString()
    const heap = stopHeap === null ? null : await stopHeap()
    const workerTargets = state.workers.slice(firstWorker).map(worker => ({ target: worker.target, attachedAtEpochMs: worker.attachedAtEpochMs, detachedAtEpochMs: worker.detachedAtEpochMs }))
    entry.cdpWorkerHeap = { intervalMs: HEAP_INTERVAL_MS, samples: heap?.samples ?? [], errors: heap?.errors ?? 0, workerTargets }
    if (stopOs) entry.osRendererMemory = await stopOs()
  }
  const newDumps = dumps().filter(name => !dumpsBefore.has(name))
  if (state.crashed || state.page.closed) {
    // Only crash-dump OOM evidence names a lack of memory; a page loss without it stays a page loss.
    const evidence = newDumps.map(oomEvidence).find(Boolean) ?? null
    const external = evidence !== null && /v8-oom-location/.test(evidence) ? { kind: 'out_of_memory', evidence } : { kind: 'page_lost', evidence: `Inspector.targetCrashed${newDumps.length ? ` (${newDumps.length} new crash dump)` : ''}` }
    return { outcome: 'page_lost', rawFile: null, external, note: null }
  }
  // The run did not settle in time: it may still be going on in this page, so nothing of the page is read any more.
  if (result === null) return { outcome: 'driver_deadline', rawFile: null, external: null, note: `The run did not settle within ${slotDeadlineMs} ms.` }
  if (!result.ok) return { outcome: 'driver_error', rawFile: null, external: null, note: `The page refused the slot: ${result.error}` }
  const text = await state.evaluate('globalThis.buildListOptimizationBenchmark.exportJson()', 300_000)
  rawIndex += 1
  const rawFile = `${String(rawIndex).padStart(2, '0')}-${slot.slotId}.json`
  writeFileSync(join(out, 'raw', rawFile), text, { flag: 'wx' })
  await state.evaluate('globalThis.buildListOptimizationBenchmark.clear()')
  log('SLOT', slot.slotId, 'saved', rawFile, JSON.stringify(result), `${Math.round((Date.now() - startedAt) / 1000)} s`)
  return { outcome: 'record_saved', rawFile, external: null, note: null }
}

try {
  const result = await control.runBloDriverSessions(sessions, { openPage, runSlot, closePage, readStorage }, { log: line => log(line), onChange: sync })
  sync(result)
} finally {
  saveRecord('driver.json', 'wx')
  log('END', `slots=${record.slots.map(slot => `${slot.slotId}:${slot.outcome}`).join(',')}`, `pageRestarts=${record.pageRestarts.length}`)
  try { await browser.send('Browser.close', {}, { timeoutMs: 10_000 }) } catch { /* closed */ }
  browser.close()
}
