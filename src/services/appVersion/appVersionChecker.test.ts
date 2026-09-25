import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAppVersionManifestJson,
  formatAppBuildIdForDisplay,
  normalizeAppBuildId,
  parseAppVersionManifest,
} from './appBuildId'
import {
  APP_VERSION_CHECK_TIMING,
  appVersionManifestUrl,
  createAppVersionChecker,
  currentAppBuildId,
  fetchLatestAppBuildId,
  startAppVersionMonitor,
  type AppVersionChecker,
} from './appVersionChecker'

const CURRENT = '1111111111111111111111111111111111111111'
const LATEST = '2222222222222222222222222222222222222222'

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json' } })
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  // Drop the own-property override so jsdom's own getter applies again.
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('build ID contract', () => {
  it('accepts a non-blank string only and never fabricates one', () => {
    expect(normalizeAppBuildId(CURRENT)).toBe(CURRENT)
    expect(normalizeAppBuildId(undefined)).toBeNull()
    expect(normalizeAppBuildId('')).toBeNull()
    expect(normalizeAppBuildId('   ')).toBeNull()
    expect(normalizeAppBuildId(42)).toBeNull()
  })

  it('round-trips the manifest the build writes', () => {
    expect(parseAppVersionManifest(JSON.parse(createAppVersionManifestJson(CURRENT)))).toBe(CURRENT)
  })

  it.each([
    ['null', null],
    ['an array', [CURRENT]],
    ['a string', CURRENT],
    ['an object without buildId', { version: CURRENT }],
    ['an empty buildId', { buildId: '' }],
    ['a non-string buildId', { buildId: 1 }],
  ])('rejects %s as a manifest', (_label, body) => {
    expect(parseAppVersionManifest(body)).toBeNull()
  })

  it('shortens the build ID for display only', () => {
    expect(formatAppBuildIdForDisplay(CURRENT)).toBe('1111111')
  })

  it('has no production build ID in a test build', () => {
    expect(currentAppBuildId).toBeNull()
  })
})

describe('appVersionManifestUrl', () => {
  it('resolves under the Vite base with a unique query', () => {
    expect(appVersionManifestUrl('/GogmaArtianPlanner/', 5)).toBe('/GogmaArtianPlanner/version.json?t=5')
    expect(appVersionManifestUrl('/base', 6)).toBe('/base/version.json?t=6')
  })
})

describe('fetchLatestAppBuildId', () => {
  it('bypasses the HTTP cache and returns the manifest build ID', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ buildId: LATEST }))
    await expect(fetchLatestAppBuildId(fetchImpl, '/x/version.json?t=1')).resolves.toBe(LATEST)
    expect(fetchImpl).toHaveBeenCalledWith('/x/version.json?t=1', { cache: 'no-store' })
  })

  it.each([
    ['an HTTP error', async () => jsonResponse({ buildId: LATEST }, { status: 404 })],
    ['a network error', async () => { throw new TypeError('Failed to fetch') }],
    ['malformed JSON', async () => new Response('<html>', { status: 200 })],
    ['a missing buildId', async () => jsonResponse({})],
    ['an empty buildId', async () => jsonResponse({ buildId: '' })],
  ])('resolves to null on %s without logging', async (_label, fetchImpl) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(fetchLatestAppBuildId(fetchImpl as typeof fetch, '/version.json')).resolves.toBeNull()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('createAppVersionChecker', () => {
  it('reports no update when the latest build ID equals the running one', async () => {
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId: async () => CURRENT })
    await expect(checker.check()).resolves.toBe(false)
    expect(checker.isUpdateAvailable()).toBe(false)
  })

  it('reports an update when the latest build ID differs and notifies subscribers once', async () => {
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId: async () => LATEST })
    const listener = vi.fn()
    checker.subscribe(listener)
    await expect(checker.check()).resolves.toBe(true)
    expect(checker.isUpdateAvailable()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('never treats an unknown manifest as an update', async () => {
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId: async () => null })
    await expect(checker.check()).resolves.toBe(false)
  })

  it('swallows a rejected fetch instead of surfacing an error', async () => {
    const checker = createAppVersionChecker({
      currentBuildId: CURRENT,
      fetchLatestBuildId: () => Promise.reject(new Error('offline')),
    })
    await expect(checker.check()).resolves.toBe(false)
  })

  it('does not fetch at all without a production build ID', async () => {
    const fetchLatestBuildId = vi.fn(async () => LATEST)
    const checker = createAppVersionChecker({ currentBuildId: null, fetchLatestBuildId })
    expect(checker.isEnabled).toBe(false)
    await expect(checker.check()).resolves.toBe(false)
    expect(fetchLatestBuildId).not.toHaveBeenCalled()
  })

  it('keeps a detected update through later failures and stops fetching', async () => {
    const fetchLatestBuildId = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(LATEST)
      .mockResolvedValue(null)
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId })
    await checker.check()
    await expect(checker.check()).resolves.toBe(true)
    expect(checker.isUpdateAvailable()).toBe(true)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
  })

  it('shares a check already in flight', async () => {
    let resolve: (value: string | null) => void = () => undefined
    const fetchLatestBuildId = vi.fn(() => new Promise<string | null>((r) => { resolve = r }))
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId })
    const first = checker.check()
    const second = checker.check()
    resolve(CURRENT)
    await Promise.all([first, second])
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
  })

  it('throttles checkIfDue by the start time of the last check', async () => {
    let now = 1_000
    const fetchLatestBuildId = vi.fn(async () => CURRENT)
    const checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId, now: () => now })
    await checker.checkIfDue(60_000)
    now += 59_999
    await checker.checkIfDue(60_000)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
    now += 1
    await checker.checkIfDue(60_000)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(2)
  })
})

describe('startAppVersionMonitor', () => {
  let fetchLatestBuildId: ReturnType<typeof vi.fn<() => Promise<string | null>>>
  let checker: AppVersionChecker

  beforeEach(() => {
    vi.useFakeTimers()
    fetchLatestBuildId = vi.fn(async () => CURRENT)
    checker = createAppVersionChecker({ currentBuildId: CURRENT, fetchLatestBuildId })
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks once at startup', async () => {
    const stop = startAppVersionMonitor(checker)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
    stop()
  })

  it('checks when the tab becomes visible again after the throttle gap', async () => {
    const stop = startAppVersionMonitor(checker)
    await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.minimumCheckGapMs)
    setVisibility('hidden')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not refetch on rapid visibility changes within the throttle gap', async () => {
    const stop = startAppVersionMonitor(checker)
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(5_000)
      setVisibility('hidden')
      setVisibility('visible')
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
    stop()
  })

  it('checks every 15 minutes while visible', async () => {
    const stop = startAppVersionMonitor(checker)
    await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.visibleIntervalMs - 1)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.visibleIntervalMs)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(3)
    stop()
  })

  it('runs no periodic check while hidden', async () => {
    const stop = startAppVersionMonitor(checker)
    await vi.advanceTimersByTimeAsync(0)
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.visibleIntervalMs * 4)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it('starts hidden without an interval and still checks once', async () => {
    setVisibility('hidden')
    const stop = startAppVersionMonitor(checker)
    await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.visibleIntervalMs * 2)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it('removes its listener and timer on stop', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const stop = startAppVersionMonitor(checker)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.minimumCheckGapMs)
    setVisibility('hidden')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.visibleIntervalMs)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
    removeSpy.mockRestore()
  })

  it('does not duplicate requests across a start / stop / start remount', async () => {
    const stopFirst = startAppVersionMonitor(checker)
    stopFirst()
    const stop = startAppVersionMonitor(checker)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchLatestBuildId).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    stop()
  })

  it('does nothing without a production build ID', async () => {
    const disabledFetch = vi.fn(async () => LATEST)
    const disabled = createAppVersionChecker({ currentBuildId: null, fetchLatestBuildId: disabledFetch })
    const stop = startAppVersionMonitor(disabled)
    setVisibility('hidden')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(APP_VERSION_CHECK_TIMING.visibleIntervalMs * 2)
    expect(disabledFetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })
})
