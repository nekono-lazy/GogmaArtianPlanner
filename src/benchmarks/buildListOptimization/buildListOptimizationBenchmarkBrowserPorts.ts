import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { BloMemoryReading, BloRunRecord, BloStorageSnapshot } from './buildListOptimizationBenchmarkProtocol'
import type { BloLongTaskSummary, BloRawWorker, BloRunnerPorts } from './buildListOptimizationBenchmarkRunner'

/**
 * Issue #260 PR-5A: the Browser implementations of the runner's ports (benchmark page only).
 *
 * Every reading is the Browser's own API as it is: a value the Browser does not offer is `null`, never estimated. The memory
 * readings are fixed points (`performance.memory`, and `performance.measureUserAgentSpecificMemory()` on a cross-origin isolated page);
 * a continuous Worker heap sampling is the external driver's (CDP), never the page's.
 */

declare const __PLANNER_GLOBAL_BENCHMARK_BUILD__: unknown

/** The benchmark build's provenance (commit, uncommitted benchmark code, code SHA-256); null outside a benchmark build. */
export function bloBenchmarkBuild(): unknown {
  return typeof __PLANNER_GLOBAL_BENCHMARK_BUILD__ === 'undefined' ? null : __PLANNER_GLOBAL_BENCHMARK_BUILD__
}

export async function bloBrowserSha256(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes.slice().buffer : bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export function bloBrowserEnvironment(): BloRunRecord['environment'] {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    userAgent: nav.userAgent ?? null,
    language: nav.language ?? null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
    isSecureContext: typeof isSecureContext === 'boolean' ? isSecureContext : null,
    visibilityAtStart: typeof document === 'undefined' ? null : document.visibilityState,
  }
}

interface ChromeMemory { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
interface UserAgentSpecificMemory { bytes: number; breakdown: { bytes: number; attribution: { scope?: string }[] }[] }

async function readMemory(label: BloMemoryReading['label'], atMs: number): Promise<BloMemoryReading> {
  const chrome = (performance as Performance & { memory?: ChromeMemory }).memory
  const mainHeap = chrome === undefined ? null : { usedJSHeapSize: chrome.usedJSHeapSize, totalJSHeapSize: chrome.totalJSHeapSize, jsHeapSizeLimit: chrome.jsHeapSizeLimit }
  const measure = (performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<UserAgentSpecificMemory> }).measureUserAgentSpecificMemory
  if (typeof measure !== 'function' || crossOriginIsolated !== true) return { label, atMs, mainHeap, userAgentSpecific: null, error: null }
  try {
    const value = await measure.call(performance)
    let workerBytes = 0, windowBytes = 0, otherBytes = 0
    for (const entry of value.breakdown) {
      const scopes = entry.attribution.map(attribution => attribution.scope)
      if (scopes.includes('DedicatedWorkerGlobalScope')) workerBytes += entry.bytes
      else if (scopes.includes('Window')) windowBytes += entry.bytes
      else otherBytes += entry.bytes
    }
    return { label, atMs, mainHeap, userAgentSpecific: { bytes: value.bytes, workerBytes, windowBytes, otherBytes }, error: null }
  } catch (error) {
    return { label, atMs, mainHeap, userAgentSpecific: null, error: error instanceof Error ? error.message : String(error) }
  }
}

async function readStorage(): Promise<BloStorageSnapshot> {
  const read = async <T>(value: () => Promise<T> | T): Promise<T | null> => {
    try {
      return await value()
    } catch {
      return null
    }
  }
  return {
    indexedDbDatabases: await read(async () => (typeof indexedDB?.databases === 'function' ? (await indexedDB.databases()).length : null)),
    localStorageKeys: await read(() => window.localStorage.length),
    sessionStorageKeys: await read(() => window.sessionStorage.length),
    cacheKeys: await read(async () => (typeof caches === 'object' ? (await caches.keys()).length : null)),
    serviceWorkerRegistrations: await read(async () => (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : null)),
  }
}

function observeLongTasks(originMs: number): { stop(): BloLongTaskSummary } {
  const entries: { startMs: number; durationMs: number }[] = []
  const supported = typeof PerformanceObserver === 'function' && (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask')
  if (!supported) return { stop: () => ({ observed: false, entries: [] }) }
  const collect = (list: PerformanceEntryList) => {
    for (const entry of list) entries.push({ startMs: entry.startTime - originMs, durationMs: entry.duration })
  }
  const observer = new PerformanceObserver(list => collect(list.getEntries()))
  observer.observe({ type: 'longtask', buffered: false })
  return {
    stop: () => {
      collect(observer.takeRecords())
      observer.disconnect()
      return { observed: true, entries: entries.filter(entry => entry.startMs >= 0) }
    },
  }
}

function observeLifecycle(listener: (type: string, visibilityState: string | null) => void): () => void {
  const onDocument = (event: Event) => listener(event.type, document.visibilityState)
  const onWindow = (event: Event) => listener(event.type, document.visibilityState)
  for (const type of ['visibilitychange', 'freeze', 'resume']) document.addEventListener(type, onDocument)
  window.addEventListener('pagehide', onWindow)
  return () => {
    for (const type of ['visibilitychange', 'freeze', 'resume']) document.removeEventListener(type, onDocument)
    window.removeEventListener('pagehide', onWindow)
  }
}

/** The measurement Worker: the benchmark-only entry over the Production controller and adapter. */
function createMeasurementWorker(): BloRawWorker {
  return new Worker(new URL('../../workers/buildListOptimization.worker.benchmark.entry.ts', import.meta.url), { type: 'module' }) as unknown as BloRawWorker
}

/** The runner's ports in the Browser. */
export function bloBrowserRunnerPorts(master: MasterDataRoot): BloRunnerPorts {
  return {
    master,
    createMeasurementWorker,
    now: () => performance.now(),
    isoNow: () => new Date().toISOString(),
    sha256Text: text => bloBrowserSha256(new TextEncoder().encode(text)),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
    environment: bloBrowserEnvironment,
    build: bloBenchmarkBuild,
    readMemory,
    readStorage,
    observeLongTasks,
    observeLifecycle,
    pageLifecycle: window,
    lateMessageWaitMs: 1_000,
  }
}
