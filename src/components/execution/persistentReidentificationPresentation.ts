import type { MasterDataRoot } from '../../domain/master/masterTypes'
import type { PersistentReidentificationReminder } from '../../services/execution/persistentReidentificationReminderService'

/**
 * The words of the persistent re-identification reminder (`docs/PLANNER_SPEC.md`
 * 16.15) shared by Dashboard, RNG Setup and Candidate Search. Presentation
 * only: it decides nothing about resolution and reads the display model alone.
 * The meaning matches the Execution Navigator's ended view: after a recorded
 * unexpected result, the diverged stream must be formally re-identified before
 * Candidate Search or a replan.
 */

export type PersistentReidentificationSurface = 'dashboard' | 'rng_setup' | 'search'

export interface PersistentReidentificationStreamItem {
  key: string
  /** The stream sentence: what is still unidentified. */
  text: string
  /** How to re-identify it, in the surface's words. */
  guidance: readonly string[]
}

export interface PersistentReidentificationReminderView {
  title: string
  description: readonly string[]
  items: readonly PersistentReidentificationStreamItem[]
  links: readonly { label: string; to: string }[]
}

export const PERSISTENT_REIDENTIFICATION_REMINDER_TITLE = '予測と異なる結果の再同定が必要です'

export const PERSISTENT_REIDENTIFICATION_REMINDER_DESCRIPTION =
  '予測と異なる結果が記録されています。現在のゲーム状態に合わせて必要なRNG状態または通常アーティアCounterを再同定してから、候補検索・再計画を行ってください。'

/** Candidate Search reads its prediction positions from the diverged state. */
export const PERSISTENT_REIDENTIFICATION_SEARCH_NOTE =
  'この検索に使われる予測位置が、ゲーム側と一致していない可能性があります。'

export const PERSISTENT_REIDENTIFICATION_RNG_TEXT =
  '予測と異なる結果が記録された後、RNG状態の再同定がまだ完了していません。'

export const PERSISTENT_REIDENTIFICATION_NORMAL_TEXT =
  '予測と異なる結果が記録された後、通常アーティアCounterの再同定がまだ完了していません。'

/** A manual save is never an Identification adoption (16.15 R2 / R5). */
export const PERSISTENT_REIDENTIFICATION_MANUAL_NOTE =
  '手動入力だけではこの再同定要求は解消されません。Identification Wizardの結果を採用してください。'

export const PERSISTENT_REIDENTIFICATION_UNRESOLVABLE_TEXT =
  '予測と異なる結果が記録されていますが、対象の通常アーティアCounterを安全に特定できません。通常アーティアCounter設定を確認してください。'

/** The read failure is never shown as "nothing to re-identify". */
export const PERSISTENT_REIDENTIFICATION_LOAD_ERROR =
  '再同定状態を確認できませんでした。予測と異なる結果が記録されている場合、再同定が必要な可能性があります。'

export const RNG_SETUP_LINK = { label: 'RNG状態設定へ', to: '/rng' } as const
export const NORMAL_COUNTERS_LINK = { label: '通常アーティアCounterへ', to: '/normal-counters' } as const

/**
 * Names the Counter's weapon type from the current record's `weaponTypeId`
 * through the Master only; a Counter with no record or an unknown weapon type
 * gets the generic sentence. The ID is never parsed and never shown.
 */
function normalCounterSentence(
  weaponTypeId: string | null,
  master: MasterDataRoot | null,
): string {
  const weaponType = weaponTypeId === null || master === null ? undefined : master.weaponTypes.find(({ id }) => id === weaponTypeId)
  return weaponType === undefined
    ? '対象の通常アーティアCounterを再同定してください。'
    : `${weaponType.displayNameJa}の通常アーティアCounterを再同定してください。`
}

export function presentPersistentReidentificationReminder(
  reminder: PersistentReidentificationReminder,
  master: MasterDataRoot | null,
  surface: PersistentReidentificationSurface,
): PersistentReidentificationReminderView | null {
  if (reminder.kind === 'none') return null
  const items: PersistentReidentificationStreamItem[] = []
  const links: { label: string; to: string }[] = []
  if (reminder.rngRequired) {
    items.push({
      key: 'rng',
      text: PERSISTENT_REIDENTIFICATION_RNG_TEXT,
      guidance: surface === 'rng_setup'
        ? ['この画面のIdentification Wizardで現在のゲーム状態に合わせて再同定してください。', PERSISTENT_REIDENTIFICATION_MANUAL_NOTE]
        : ['Identification Wizardで現在のゲーム状態に合わせて再同定してください。', PERSISTENT_REIDENTIFICATION_MANUAL_NOTE],
    })
    // RNG Setup is the destination itself: no self-link.
    if (surface !== 'rng_setup') links.push(RNG_SETUP_LINK)
  }
  if (reminder.normalCounters.length > 0) {
    items.push({
      key: 'normal_counters',
      text: PERSISTENT_REIDENTIFICATION_NORMAL_TEXT,
      guidance: reminder.normalCounters.map(({ weaponTypeId }) => normalCounterSentence(weaponTypeId, master)),
    })
  }
  if (reminder.hasUnresolvableNormalCounter) {
    items.push({ key: 'unresolvable', text: PERSISTENT_REIDENTIFICATION_UNRESOLVABLE_TEXT, guidance: [] })
  }
  if (reminder.normalCounters.length > 0 || reminder.hasUnresolvableNormalCounter) links.push(NORMAL_COUNTERS_LINK)
  return {
    title: PERSISTENT_REIDENTIFICATION_REMINDER_TITLE,
    description: surface === 'search'
      ? [PERSISTENT_REIDENTIFICATION_REMINDER_DESCRIPTION, PERSISTENT_REIDENTIFICATION_SEARCH_NOTE]
      : [PERSISTENT_REIDENTIFICATION_REMINDER_DESCRIPTION],
    items,
    links,
  }
}
