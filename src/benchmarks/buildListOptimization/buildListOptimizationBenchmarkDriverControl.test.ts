import { describe, expect, it } from 'vitest'
import {
  BLO_CANCEL_DETACH_OBSERVATION_WINDOW_MS,
  BLO_CANCEL_DETACH_POLL_MS,
  bloCancelDetachObservationIssue,
  bloCancelRequestEpochMs,
  bloDriverLaunchModeIssue,
  bloDriverSlotExclusions,
  bloObservedBrowserMode,
  bloPageBrowserModeIssue,
  observeBloCancelWorkerDetach,
  runBloDriverSessions,
  type BloCancelDetachPort,
  type BloDriverPagePort,
  type BloDriverSession,
  type BloDriverSlotEnd,
} from './buildListOptimizationBenchmarkDriverControl'
import { TEST_USER_AGENT } from './buildListOptimizationBenchmarkTestFixture'

/*
 * Issue #260 PR-5A: the driver's slot control. A page is reused only after a slot ended with a saved record; any other end closes it
 * (its Worker with it), opens a new page for the next slot and never runs the ended slot again; a page that cannot be opened leaves
 * the remaining slots unrun. The Browser mode is the plan's, checked at launch and on every page.
 */

interface FakePage { index: number; closed: boolean; runs: string[] }
type Script = Record<string, BloDriverSlotEnd | 'throw' | ((page: FakePage) => BloDriverSlotEnd)>

function fakePort(script: Script, options: { failOpen?: number[] } = {}) {
  const pages: FakePage[] = []
  const calls: string[] = []
  const port: BloDriverPagePort<FakePage, { slotId: string }> = {
    openPage: async (session, index) => {
      calls.push(`open:${session.sessionId}#${index}`)
      if (options.failOpen?.includes(index)) throw new Error(`page #${index} is built from other code`)
      const page = { index, closed: false, runs: [] }
      pages.push(page)
      return page
    },
    runSlot: async (page, slot, entry) => {
      calls.push(`run:${slot.slotId}@${page.index}`)
      if (page.closed) throw new Error('ran on a closed page')
      page.runs.push(slot.slotId)
      entry.startedAt = '2026-10-15T00:00:00.000Z'
      entry.cpuLoadPercentBefore = 5
      const step = script[slot.slotId] ?? { outcome: 'record_saved', rawFile: `${slot.slotId}.json`, external: null, note: null }
      if (step === 'throw') throw new Error('CDP Runtime.evaluate timed out')
      return typeof step === 'function' ? step(page) : step
    },
    closePage: async (page) => {
      calls.push(`close#${page.index}`)
      page.closed = true
    },
    readStorage: async (page) => ({ page: page.index }),
  }
  return { port, pages, calls }
}

const session = (sessionId: string, origin: string, ...slotIds: string[]): BloDriverSession<{ slotId: string }> => ({ sessionId, origin, slots: slotIds.map(slotId => ({ slotId })) })
const deadline: BloDriverSlotEnd = { outcome: 'driver_deadline', rawFile: null, external: null, note: 'The run did not settle within 1000 ms.' }

describe('Build List optimization driver slot control (Issue #260 PR-5A)', () => {
  it('reuses one page for slots that ended with a saved record, and closes it at the end of the session', async () => {
    const { port, calls } = fakePort({})
    const result = await runBloDriverSessions([session('s1', 'non_isolated', 'a', 'b', 'c')], port)
    expect(calls).toEqual(['open:s1#1', 'run:a@1', 'run:b@1', 'run:c@1', 'close#1'])
    expect(result.slots.map(slot => [slot.slotId, slot.outcome, slot.pageIndex, slot.rawFile])).toEqual([['a', 'record_saved', 1, 'a.json'], ['b', 'record_saved', 1, 'b.json'], ['c', 'record_saved', 1, 'c.json']])
    expect(result.pageRestarts).toEqual([])
    expect(result.sessions).toEqual([{ sessionId: 's1', origin: 'non_isolated', storageBefore: { page: 1 }, storageAfter: { page: 1 }, pageLost: false, pagesOpened: 1, pageOpenFailures: [] }])
    expect(result.slots[0]!.cpuLoadPercentBefore).toBe(5)
  })

  it('leaves a page after the driver deadline: the slot is not run again and the next slot runs on a new page', async () => {
    const { port, calls, pages } = fakePort({ b: deadline })
    const result = await runBloDriverSessions([session('s1', 'non_isolated', 'a', 'b', 'c', 'd')], port)
    expect(calls).toEqual(['open:s1#1', 'run:a@1', 'run:b@1', 'close#1', 'open:s1#2', 'run:c@2', 'run:d@2', 'close#2'])
    expect(result.slots.map(slot => [slot.slotId, slot.outcome, slot.pageIndex, slot.rawFile])).toEqual([
      ['a', 'record_saved', 1, 'a.json'], ['b', 'driver_deadline', 1, null], ['c', 'record_saved', 2, 'c.json'], ['d', 'record_saved', 2, 'd.json'],
    ])
    expect(result.slots[1]!.note).toBe('The run did not settle within 1000 ms.')
    expect(result.pageRestarts).toEqual([{ sessionId: 's1', afterSlotId: 'b', reason: 'driver_deadline', closedPageIndex: 1, openedPageIndex: 2 }])
    // The timed-out slot ran once, on the closed page; the new page never saw it.
    expect(pages[0]!.runs).toEqual(['a', 'b'])
    expect(pages[1]!.runs).toEqual(['c', 'd'])
    expect(pages[0]!.closed).toBe(true)
    // The session's storage after is read from the live (new) page.
    expect(result.sessions[0]).toMatchObject({ storageAfter: { page: 2 }, pageLost: false, pagesOpened: 2 })
  })

  it('treats a lost page and an error of unknown settlement the same way, keeping their own ends', async () => {
    const lost: BloDriverSlotEnd = { outcome: 'page_lost', rawFile: null, external: { kind: 'page_lost', evidence: 'Inspector.targetCrashed' }, note: null }
    const { port, calls } = fakePort({ a: lost, c: 'throw' })
    const result = await runBloDriverSessions([session('s1', 'non_isolated', 'a', 'b', 'c', 'd')], port)
    expect(calls).toEqual(['open:s1#1', 'run:a@1', 'close#1', 'open:s1#2', 'run:b@2', 'run:c@2', 'close#2', 'open:s1#3', 'run:d@3', 'close#3'])
    expect(result.slots.map(slot => [slot.slotId, slot.outcome, slot.pageIndex])).toEqual([['a', 'page_lost', 1], ['b', 'record_saved', 2], ['c', 'driver_error', 2], ['d', 'record_saved', 3]])
    expect(result.slots[0]!.external).toEqual({ kind: 'page_lost', evidence: 'Inspector.targetCrashed' })
    expect(result.slots[2]).toMatchObject({ note: 'CDP Runtime.evaluate timed out', external: null, rawFile: null, startedAt: '2026-10-15T00:00:00.000Z' })
    expect(result.pageRestarts.map(restart => [restart.afterSlotId, restart.reason])).toEqual([['a', 'page_lost'], ['c', 'driver_error']])
    expect(result.sessions[0]!.pageLost).toBe(true)
  })

  it('leaves the remaining slots unrun when no verified page can be opened, and goes on with the next session', async () => {
    const { port, calls } = fakePort({ a: deadline }, { failOpen: [2] })
    const result = await runBloDriverSessions([session('s1', 'non_isolated', 'a', 'b', 'c'), session('s2', 'isolated', 'm')], port)
    expect(calls).toEqual(['open:s1#1', 'run:a@1', 'close#1', 'open:s1#2', 'open:s2#3', 'run:m@3', 'close#3'])
    expect(result.slots.map(slot => [slot.slotId, slot.outcome, slot.pageIndex])).toEqual([['a', 'driver_deadline', 1], ['b', 'not_run', null], ['c', 'not_run', null], ['m', 'record_saved', 3]])
    expect(result.pageRestarts).toEqual([{ sessionId: 's1', afterSlotId: 'a', reason: 'driver_deadline', closedPageIndex: 1, openedPageIndex: null }])
    expect(result.sessions[0]).toMatchObject({ storageAfter: null, pagesOpened: 1, pageOpenFailures: ['page #2 is built from other code'] })
  })

  it('reads the exclusions back from a driver record: an unsaved slot, and a later slot on a page that saw an abnormal end', () => {
    const exclusions = bloDriverSlotExclusions([
      { slotId: 'a', sessionId: 's1', pageIndex: 1, outcome: 'record_saved' },
      { slotId: 'b', sessionId: 's1', pageIndex: 1, outcome: 'driver_deadline' },
      { slotId: 'c', sessionId: 's1', pageIndex: 1, outcome: 'record_saved' },
      { slotId: 'd', sessionId: 's1', pageIndex: 2, outcome: 'record_saved' },
      { slotId: 'e', sessionId: 's1', pageIndex: null, outcome: 'not_run' },
    ])
    expect([...exclusions]).toEqual([['b', 'driver_outcome_not_saved'], ['c', 'page_not_replaced'], ['e', 'driver_outcome_not_saved']])
  })

  describe('the Worker release after a cancel (PR-5B r2)', () => {
    const CANCEL = 1_792_000_000_000
    /** A fake Browser on a fake clock: the Worker detaches at `detachAt` (or never), the page may stop responding at `pageLostAt`. */
    function fakeBrowser(options: { workers?: { target: string; attachedAt: number; detachAt: number | null }[]; pageLostAt?: number; startAt?: number }) {
      let now = options.startAt ?? CANCEL + 1_000
      const workers = options.workers ?? [{ target: 'worker-4', attachedAt: CANCEL - 2_000, detachAt: CANCEL + 2_015 }]
      const sleeps: number[] = []
      const port: BloCancelDetachPort = {
        now: () => now,
        sleep: async (ms) => { sleeps.push(ms); now += ms },
        slotWorkers: () => workers.map(worker => ({ target: worker.target, attachedAtEpochMs: worker.attachedAt, detachedAtEpochMs: worker.detachAt !== null && worker.detachAt <= now ? worker.detachAt : null })),
        pageResponds: async () => options.pageLostAt === undefined || now < options.pageLostAt,
      }
      return { port, sleeps, clock: () => now }
    }

    it('records the release of the slot Worker and stops as soon as it detaches', async () => {
      const browser = fakeBrowser({})
      const observation = await observeBloCancelWorkerDetach(CANCEL, browser.port)
      expect(observation).toEqual({ outcome: 'detached', target: 'worker-4', cancelRequestedAtEpochMs: CANCEL, detachedAtEpochMs: CANCEL + 2_015, windowMs: 10_000, observedUntilEpochMs: CANCEL + 2_050 })
      // It started after the run settled (1 s after the cancel) and waited only until the detach, never to the end of the window.
      expect(browser.clock() - CANCEL).toBe(2_050)
      expect(browser.sleeps.every(ms => ms === BLO_CANCEL_DETACH_POLL_MS)).toBe(true)
      expect(BLO_CANCEL_DETACH_OBSERVATION_WINDOW_MS).toBeGreaterThan(3_000)
      // A Worker that is already gone when the observation starts is read at once.
      const early = fakeBrowser({ workers: [{ target: 'worker-4', attachedAt: CANCEL - 2_000, detachAt: CANCEL + 300 }] })
      expect(await observeBloCancelWorkerDetach(CANCEL, early.port)).toMatchObject({ outcome: 'detached', detachedAtEpochMs: CANCEL + 300 })
      expect(early.sleeps).toEqual([])
    })

    it('makes up no release: no detach in the window, a lost page, an unidentifiable Worker, a detach before the cancel', async () => {
      const never = fakeBrowser({ workers: [{ target: 'worker-4', attachedAt: CANCEL - 2_000, detachAt: null }] })
      expect(await observeBloCancelWorkerDetach(CANCEL, never.port)).toMatchObject({ outcome: 'not_observed', target: 'worker-4', detachedAtEpochMs: null })
      expect(never.clock()).toBe(CANCEL + 10_000)
      // The page vanished: its Workers' targets go with it, which is no release.
      const lost = fakeBrowser({ workers: [{ target: 'worker-4', attachedAt: CANCEL - 2_000, detachAt: CANCEL + 1_500 }], pageLostAt: CANCEL + 1_500 })
      expect(await observeBloCancelWorkerDetach(CANCEL, lost.port)).toMatchObject({ outcome: 'page_lost', target: 'worker-4', detachedAtEpochMs: null })
      const lostLater = fakeBrowser({ workers: [{ target: 'worker-4', attachedAt: CANCEL - 2_000, detachAt: null }], pageLostAt: CANCEL + 5_000 })
      expect(await observeBloCancelWorkerDetach(CANCEL, lostLater.port)).toMatchObject({ outcome: 'page_lost', detachedAtEpochMs: null })
      // Two Worker targets in the slot, none, or one attached after the cancel: no Worker is guessed.
      for (const workers of [
        [{ target: 'worker-4', attachedAt: CANCEL - 2_000, detachAt: CANCEL + 2_015 }, { target: 'worker-5', attachedAt: CANCEL - 1_000, detachAt: CANCEL + 100 }],
        [],
        [{ target: 'worker-5', attachedAt: CANCEL + 10, detachAt: CANCEL + 100 }],
      ]) {
        expect(await observeBloCancelWorkerDetach(CANCEL, fakeBrowser({ workers }).port)).toMatchObject({ outcome: 'worker_not_identified', target: null, detachedAtEpochMs: null })
      }
      const before = fakeBrowser({ workers: [{ target: 'worker-4', attachedAt: CANCEL - 2_000, detachAt: CANCEL - 5 }] })
      expect(await observeBloCancelWorkerDetach(CANCEL, before.port)).toMatchObject({ outcome: 'detached_before_cancel', detachedAtEpochMs: CANCEL - 5 })
      // Another Worker's later detach is never read as the slot Worker's.
      const other = fakeBrowser({ workers: [{ target: 'worker-4', attachedAt: CANCEL - 2_000, detachAt: null }] })
      const port = { ...other.port, slotWorkers: () => [...other.port.slotWorkers(), ...(other.clock() > CANCEL + 2_000 ? [{ target: 'worker-9', attachedAtEpochMs: CANCEL + 1_900, detachedAtEpochMs: CANCEL + 2_000 }] : [])] }
      expect(await observeBloCancelWorkerDetach(CANCEL, port)).toMatchObject({ outcome: 'not_observed', target: 'worker-4', detachedAtEpochMs: null })
    })

    it('observes a run only when its saved record carries a cancel request, and checks the observation shape', () => {
      const record = (cancelRequestedAtMs: number | null) => ({ startedAt: '2026-10-15T06:00:00.000Z', timeline: { cancelRequestedAtMs } })
      expect(bloCancelRequestEpochMs(record(2_191.6))).toBe(Date.parse('2026-10-15T06:00:00.000Z') + 2_191.6)
      // A run without a cancel request (every non-cancel slot, a cancel trial whose cancel never ran) is not observed: as before.
      expect(bloCancelRequestEpochMs(record(null))).toBeNull()
      expect(bloCancelRequestEpochMs({ startedAt: 'not a date', timeline: { cancelRequestedAtMs: 5 } })).toBeNull()
      const detached = { outcome: 'detached', target: 'worker-4', cancelRequestedAtEpochMs: CANCEL, detachedAtEpochMs: CANCEL + 2_015, windowMs: 10_000, observedUntilEpochMs: CANCEL + 2_050 }
      expect(bloCancelDetachObservationIssue(null)).toBeNull()
      expect(bloCancelDetachObservationIssue(detached)).toBeNull()
      expect(bloCancelDetachObservationIssue({ ...detached, outcome: 'not_observed', detachedAtEpochMs: null })).toBeNull()
      expect(bloCancelDetachObservationIssue({ ...detached, outcome: 'not_observed' })).toMatch(/detach time goes exactly with a detached outcome/)
      expect(bloCancelDetachObservationIssue({ ...detached, detachedAtEpochMs: null })).toMatch(/detach time goes exactly/)
      expect(bloCancelDetachObservationIssue({ ...detached, outcome: 'worker_not_identified', detachedAtEpochMs: null })).toMatch(/target goes exactly with an identified Worker/)
      expect(bloCancelDetachObservationIssue({ ...detached, outcome: 'released' })).toMatch(/known outcome/)
      expect(bloCancelDetachObservationIssue({ ...detached, windowMs: undefined })).toMatch(/window/)
    })
  })

  it('decides the Browser mode from the plan at launch and from the page itself', () => {
    expect(bloDriverLaunchModeIssue('measurement', 'headed', 'headed')).toBeNull()
    expect(bloDriverLaunchModeIssue('measurement', 'headed', 'headless')).toBe('The plan requires a headed Browser; the driver was asked to launch headless.')
    expect(bloDriverLaunchModeIssue('measurement', 'headless', 'headed')).toMatch(/requires a headless Browser/)
    expect(bloDriverLaunchModeIssue('measurement', 'either', 'headed')).toBe('Only a mechanics plan accepts either Browser mode.')
    expect(bloDriverLaunchModeIssue('measurement', undefined, 'headed')).toBe('The plan names no Browser mode (got undefined).')
    expect(bloDriverLaunchModeIssue('measurement', 'visible', 'headed')).toMatch(/names no Browser mode/)
    expect(bloDriverLaunchModeIssue('mechanics', 'either', 'headless')).toBeNull()
    expect(bloDriverLaunchModeIssue('mechanics', 'either', 'headed')).toBeNull()
    const headlessAgent = TEST_USER_AGENT.replace('Chrome/', 'HeadlessChrome/')
    expect(bloObservedBrowserMode(TEST_USER_AGENT)).toBe('headed')
    expect(bloObservedBrowserMode(headlessAgent)).toBe('headless')
    expect(bloObservedBrowserMode(null)).toBeNull()
    expect(bloPageBrowserModeIssue(TEST_USER_AGENT, 'headed')).toBeNull()
    expect(bloPageBrowserModeIssue(headlessAgent, 'headed')).toBe('The page runs headless Browser, not the launched headed one.')
    expect(bloPageBrowserModeIssue(null, 'headless')).toBe('The page runs an unknown Browser, not the launched headless one.')
  })
})
