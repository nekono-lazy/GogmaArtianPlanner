import { describe, expect, it } from 'vitest'
import { loadMasterData } from '../../domain/master/loadMasterData'
import type { PersistentReidentificationReminder } from '../../services/execution/persistentReidentificationReminderService'
import {
  NORMAL_COUNTERS_LINK,
  PERSISTENT_REIDENTIFICATION_MANUAL_NOTE,
  PERSISTENT_REIDENTIFICATION_NORMAL_TEXT,
  PERSISTENT_REIDENTIFICATION_REMINDER_DESCRIPTION,
  PERSISTENT_REIDENTIFICATION_REMINDER_TITLE,
  PERSISTENT_REIDENTIFICATION_RNG_TEXT,
  PERSISTENT_REIDENTIFICATION_SEARCH_NOTE,
  PERSISTENT_REIDENTIFICATION_UNRESOLVABLE_TEXT,
  RNG_SETUP_LINK,
  presentPersistentReidentificationReminder,
} from './persistentReidentificationPresentation'

const loadedMaster = loadMasterData()
if (!loadedMaster.ok) throw new Error('Master data must load for the presentation tests.')
const master = loadedMaster.data
const dualBlades = master.weaponTypes.find(({ id }) => id === 'weapon.dual_blades')
if (!dualBlades) throw new Error('The Master must define Dual Blades.')

const both: PersistentReidentificationReminder = {
  kind: 'actual_result_different',
  rngRequired: true,
  normalCounters: [{ normalCounterId: 'weapon.dual_blades:8', weaponTypeId: 'weapon.dual_blades' }],
  hasUnresolvableNormalCounter: false,
}

describe('presentPersistentReidentificationReminder', () => {
  it('presents nothing for none', () => {
    expect(presentPersistentReidentificationReminder({ kind: 'none' }, master, 'dashboard')).toBeNull()
  })

  it('names the RNG stream with its Wizard guidance and the RNG Setup link on the Dashboard', () => {
    const view = presentPersistentReidentificationReminder({ ...both, normalCounters: [] }, master, 'dashboard')
    expect(view).toMatchObject({
      title: PERSISTENT_REIDENTIFICATION_REMINDER_TITLE,
      description: [PERSISTENT_REIDENTIFICATION_REMINDER_DESCRIPTION],
      items: [{ key: 'rng', text: PERSISTENT_REIDENTIFICATION_RNG_TEXT, guidance: ['Identification Wizardで現在のゲーム状態に合わせて再同定してください。', PERSISTENT_REIDENTIFICATION_MANUAL_NOTE] }],
      links: [RNG_SETUP_LINK],
    })
  })

  it('names the Counter through the Master weapon type, never through the ID, and links the Normal Counters', () => {
    const view = presentPersistentReidentificationReminder({ ...both, rngRequired: false }, master, 'dashboard')
    expect(view).toMatchObject({
      items: [{ key: 'normal_counters', text: PERSISTENT_REIDENTIFICATION_NORMAL_TEXT, guidance: [`${dualBlades.displayNameJa}の通常アーティアCounterを再同定してください。`] }],
      links: [NORMAL_COUNTERS_LINK],
    })
    expect(JSON.stringify(view)).not.toContain('weapon.dual_blades')
  })

  it('falls back to the generic sentence for a Counter without a record, an unknown weapon type or no Master', () => {
    const generic = '対象の通常アーティアCounterを再同定してください。'
    const noRecord = { ...both, rngRequired: false, normalCounters: [{ normalCounterId: 'weapon.dual_blades:8', weaponTypeId: null }] }
    expect(presentPersistentReidentificationReminder(noRecord, master, 'dashboard')?.items[0].guidance).toEqual([generic])
    const unknownType = { ...both, rngRequired: false, normalCounters: [{ normalCounterId: 'x:8', weaponTypeId: 'weapon.unknown' }] }
    expect(presentPersistentReidentificationReminder(unknownType, master, 'dashboard')?.items[0].guidance).toEqual([generic])
    expect(presentPersistentReidentificationReminder(both, null, 'dashboard')?.items[1].guidance).toEqual([generic])
  })

  it('shows the unresolvable Normal divergence as its own generic item with the Normal Counters link', () => {
    const view = presentPersistentReidentificationReminder(
      { kind: 'actual_result_different', rngRequired: false, normalCounters: [], hasUnresolvableNormalCounter: true },
      master,
      'dashboard',
    )
    expect(view).toMatchObject({
      items: [{ key: 'unresolvable', text: PERSISTENT_REIDENTIFICATION_UNRESOLVABLE_TEXT, guidance: [] }],
      links: [NORMAL_COUNTERS_LINK],
    })
  })

  it('lists both streams in order with both links', () => {
    const view = presentPersistentReidentificationReminder(both, master, 'dashboard')
    expect(view?.items.map(({ key }) => key)).toEqual(['rng', 'normal_counters'])
    expect(view?.links).toEqual([RNG_SETUP_LINK, NORMAL_COUNTERS_LINK])
  })

  it('on RNG Setup, points at this screen Wizard and omits the self-link while keeping the Normal Counters link', () => {
    const view = presentPersistentReidentificationReminder(both, master, 'rng_setup')
    expect(view?.items[0].guidance).toEqual(['この画面のIdentification Wizardで現在のゲーム状態に合わせて再同定してください。', PERSISTENT_REIDENTIFICATION_MANUAL_NOTE])
    expect(view?.links).toEqual([NORMAL_COUNTERS_LINK])
  })

  it('on Candidate Search, adds the prediction position note and keeps both links', () => {
    const view = presentPersistentReidentificationReminder(both, master, 'search')
    expect(view?.description).toEqual([PERSISTENT_REIDENTIFICATION_REMINDER_DESCRIPTION, PERSISTENT_REIDENTIFICATION_SEARCH_NOTE])
    expect(view?.links).toEqual([RNG_SETUP_LINK, NORMAL_COUNTERS_LINK])
  })
})
