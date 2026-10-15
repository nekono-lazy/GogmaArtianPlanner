import { describe, expect, it } from 'vitest'
import {
  bloDriverLaunchModeIssue,
  bloDriverSlotExclusions,
  bloObservedBrowserMode,
  bloPageBrowserModeIssue,
  runBloDriverSessions,
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
