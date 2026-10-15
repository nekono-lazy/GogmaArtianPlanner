/**
 * Issue #260 PR-5A: the slot control of the external CDP driver (benchmark only; loaded by
 * `scripts/drive-build-list-optimization-browser.mjs` and read by the analysis, never by the page or the Worker).
 *
 * The driver runs the plan's slots in order, one page per session origin. A page is reused for the next slot only when its slot
 * ended with a saved record, which means the page's runner settled (the Client settled the run and terminated its Worker). Every
 * other end - the driver's deadline, a lost page, an error after which the run's settlement is unknown - closes that page (and the
 * Worker with it) and opens a new, re-verified page for the next slot; the slot that ended so is recorded with its end and never run
 * again. A page that cannot be opened leaves the session's remaining slots unrun (`not_run`): nothing fills them in.
 *
 * The analysis reads the same rules back from the driver record (`bloDriverSlotExclusions()`): a record is bound to its slot only
 * when the driver saved it for that slot, and no record of a page that saw an abnormal end is accepted after that end.
 */

/** How one slot ended in the driver. Only `record_saved` lets the page be reused. */
export type BloDriverSlotOutcome = 'record_saved' | 'page_lost' | 'driver_deadline' | 'driver_error' | 'not_run'

export interface BloDriverExternal {
  kind: 'page_lost' | 'out_of_memory'
  evidence: string
}

/** The driver record's entry of one slot. The page port fills in the measurement details it has (also when it then throws). */
export interface BloDriverSlotEntry {
  slotId: string
  sessionId: string
  /** The page the slot ran on (1, 2, ... across the whole driver run); null when it never had one. */
  pageIndex: number | null
  startedAt: string | null
  endedAt: string | null
  outcome: BloDriverSlotOutcome
  rawFile: string | null
  external: BloDriverExternal | null
  /** Why the slot did not end with a saved record (the error message, the deadline, the unavailable page). */
  note: string | null
  [detail: string]: unknown
}

export interface BloDriverSlotEnd {
  outcome: Exclude<BloDriverSlotOutcome, 'not_run'>
  rawFile: string | null
  external: BloDriverExternal | null
  note: string | null
}

export interface BloDriverPageRestart {
  sessionId: string
  /** The slot whose end made the driver leave the page. */
  afterSlotId: string
  reason: Exclude<BloDriverSlotOutcome, 'record_saved' | 'not_run'>
  closedPageIndex: number
  /** The page opened in its place, or null when none could be opened. */
  openedPageIndex: number | null
}

export interface BloDriverSessionEntry {
  sessionId: string
  origin: string
  storageBefore: unknown
  storageAfter: unknown
  pageLost: boolean
  pagesOpened: number
  pageOpenFailures: string[]
}

export interface BloDriverSession<Slot> {
  sessionId: string
  origin: string
  slots: Slot[]
}

/** What the driver does to the Browser; the control decides when. */
export interface BloDriverPagePort<Page, Slot extends { slotId: string }> {
  /** Opens a page of the session's origin and verifies it (build provenance, origin, isolation, Browser mode); throws when it cannot. */
  openPage(session: BloDriverSession<Slot>, pageIndex: number): Promise<Page>
  /** Runs one slot on the page and saves its record; throws when the run's settlement is unknown. */
  runSlot(page: Page, slot: Slot, entry: BloDriverSlotEntry): Promise<BloDriverSlotEnd>
  /** Closes the page (its Workers end with it). Must not throw. */
  closePage(page: Page): Promise<void>
  readStorage(page: Page): Promise<unknown>
}

export interface BloDriverControlResult {
  sessions: BloDriverSessionEntry[]
  slots: BloDriverSlotEntry[]
  pageRestarts: BloDriverPageRestart[]
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Runs every session's slots in order (see the module comment). `onChange` is called after every slot and page change, so the driver
 * can save its partial record; `log` receives one line per event.
 */
export async function runBloDriverSessions<Page, Slot extends { slotId: string }>(
  sessions: readonly BloDriverSession<Slot>[],
  port: BloDriverPagePort<Page, Slot>,
  hooks: { log?: (line: string) => void; onChange?: (result: BloDriverControlResult) => void } = {},
): Promise<BloDriverControlResult> {
  const result: BloDriverControlResult = { sessions: [], slots: [], pageRestarts: [] }
  const log = hooks.log ?? (() => undefined)
  const changed = () => hooks.onChange?.(result)
  let pageCounter = 0

  for (const session of sessions) {
    const entry: BloDriverSessionEntry = { sessionId: session.sessionId, origin: session.origin, storageBefore: null, storageAfter: null, pageLost: false, pagesOpened: 0, pageOpenFailures: [] }
    result.sessions.push(entry)
    const open = async (): Promise<{ page: Page; index: number } | null> => {
      pageCounter += 1
      const index = pageCounter
      try {
        const page = await port.openPage(session, index)
        entry.pagesOpened += 1
        log(`PAGE ${session.sessionId} opened #${index}`)
        return { page, index }
      } catch (error) {
        entry.pageOpenFailures.push(messageOf(error))
        log(`PAGE ${session.sessionId} could not open #${index}: ${messageOf(error)}`)
        return null
      }
    }
    let current = await open()
    if (current !== null) entry.storageBefore = await port.readStorage(current.page).catch(() => null)
    changed()
    for (const slot of session.slots) {
      const slotEntry: BloDriverSlotEntry = {
        slotId: slot.slotId, sessionId: session.sessionId, pageIndex: current?.index ?? null, startedAt: null, endedAt: null,
        outcome: 'not_run', rawFile: null, external: null, note: null,
      }
      result.slots.push(slotEntry)
      if (current === null) {
        slotEntry.note = 'No verified page was available: the slot was not run.'
        log(`SLOT ${slot.slotId} not_run (no page)`)
        changed()
        continue
      }
      let end: BloDriverSlotEnd
      try {
        end = await port.runSlot(current.page, slot, slotEntry)
      } catch (error) {
        // The run may still be going on in the page: its settlement is unknown, so the page is never reused.
        end = { outcome: 'driver_error', rawFile: null, external: null, note: messageOf(error) }
      }
      slotEntry.outcome = end.outcome
      slotEntry.rawFile = end.outcome === 'record_saved' ? end.rawFile : null
      slotEntry.external = end.external
      slotEntry.note = end.note
      slotEntry.endedAt ??= new Date().toISOString()
      log(`SLOT ${slot.slotId} ${end.outcome}${end.rawFile ? ` ${end.rawFile}` : ''}`)
      if (end.outcome !== 'record_saved') {
        if (end.outcome === 'page_lost') entry.pageLost = true
        const closed = current.index
        await port.closePage(current.page)
        current = await open()
        result.pageRestarts.push({ sessionId: session.sessionId, afterSlotId: slot.slotId, reason: end.outcome, closedPageIndex: closed, openedPageIndex: current?.index ?? null })
      }
      changed()
    }
    if (current !== null) {
      entry.storageAfter = await port.readStorage(current.page).catch(() => null)
      await port.closePage(current.page)
    }
    changed()
  }
  return result
}

export type BloDriverExclusionReason = 'driver_outcome_not_saved' | 'driver_source_mismatch' | 'page_not_replaced'

/**
 * The slots whose records must not be bound, read from a driver record: a slot the driver did not end with a saved record, and a
 * slot that ran on a page after that page saw an abnormal end (the driver must have replaced it). The binding also refuses a record
 * that came from another raw file than the one the driver saved for its slot (`bindBloRecordsToPlan()`).
 */
export function bloDriverSlotExclusions(slots: readonly Pick<BloDriverSlotEntry, 'slotId' | 'sessionId' | 'pageIndex' | 'outcome'>[]): Map<string, BloDriverExclusionReason> {
  const exclusions = new Map<string, BloDriverExclusionReason>()
  const tainted = new Set<number>()
  for (const slot of slots) {
    if (slot.pageIndex !== null && tainted.has(slot.pageIndex)) exclusions.set(slot.slotId, 'page_not_replaced')
    else if (slot.outcome !== 'record_saved') exclusions.set(slot.slotId, 'driver_outcome_not_saved')
    if (slot.outcome !== 'record_saved' && slot.pageIndex !== null) tainted.add(slot.pageIndex)
  }
  return exclusions
}

/** The Browser mode a page shows itself: a headless Chrome names `HeadlessChrome` in its user agent; null when no user agent was read. */
export function bloObservedBrowserMode(userAgent: string | null): 'headed' | 'headless' | null {
  if (userAgent === null) return null
  return userAgent.includes('HeadlessChrome') ? 'headless' : 'headed'
}

/**
 * Why the driver must not launch (null = it may): the plan environment's Browser mode decides. A mode-bound environment (`headed` /
 * `headless`) accepts only that launch; `either` is a mechanics plan's only; a missing or unknown mode fails closed.
 */
export function bloDriverLaunchModeIssue(planKind: unknown, planBrowserMode: unknown, launch: 'headed' | 'headless'): string | null {
  if (planBrowserMode === 'either') return planKind === 'mechanics' ? null : 'Only a mechanics plan accepts either Browser mode.'
  if (planBrowserMode !== 'headed' && planBrowserMode !== 'headless') return `The plan names no Browser mode (got ${String(planBrowserMode)}).`
  return planBrowserMode === launch ? null : `The plan requires a ${planBrowserMode} Browser; the driver was asked to launch ${launch}.`
}

/** Why an opened page must not be used (null = it may): it must show the launched Browser mode itself. */
export function bloPageBrowserModeIssue(userAgent: string | null, launch: 'headed' | 'headless'): string | null {
  const observed = bloObservedBrowserMode(userAgent)
  return observed === launch ? null : `The page runs ${observed ?? 'an unknown'} Browser, not the launched ${launch} one.`
}
