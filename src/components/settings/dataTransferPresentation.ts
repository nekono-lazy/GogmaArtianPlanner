import type { DomainValidationIssue } from '../../domain/models/publicTypes'
import {
  DataTransferError,
  type ImportPreparationResult,
} from '../../services/dataTransfer/importExportService'

/*
 * Presentation of the Settings screen's data management (`docs/UI_FLOW.md` 14):
 * the Japanese feedback for Export / Import / clear outcomes and the browser
 * download of the Export JSON. It decides nothing about the data: every
 * validation, migration and write decision stays in `ImportExportService`, and
 * this module only turns its typed outcomes into sentences.
 */

/** The one Data Transfer read / write running at a time (`docs/UI_FLOW.md` 14). */
export type DataTransferOperation =
  | 'export'
  | 'import_prepare'
  | 'import_apply'
  | 'clear'
  | null

export interface DataTransferFeedback {
  severity: 'success' | 'error'
  message: string
  /** Domain validation issues shown as a bounded, scrollable list; empty when none apply. */
  issues: readonly string[]
}

/** The default filename of the downloaded backup; a UI convenience, not a Domain contract. */
export const EXPORT_DOWNLOAD_FILENAME = 'gogma-artian-planner-backup.json'

export const dataTransferSuccessMessages = {
  export: 'バックアップファイルをエクスポートしました。',
  import: 'データをインポートしました。',
  clear: 'すべてのデータを削除し、初期状態に戻しました。',
} as const

const UNCHANGED_NOTE = '保存済みデータは変更されていません。'

/** One issue line for the user: the path locates it, the Domain message names it. */
export function formatValidationIssue(issue: DomainValidationIssue): string {
  return issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`
}

function success(message: string): DataTransferFeedback {
  return { severity: 'success', message, issues: [] }
}

function failure(message: string, issues: readonly DomainValidationIssue[] = []): DataTransferFeedback {
  return { severity: 'error', message, issues: issues.map(formatValidationIssue) }
}

export function exportSucceededFeedback(): DataTransferFeedback {
  return success(dataTransferSuccessMessages.export)
}

/** Export never writes, so every failure leaves the data as it was. */
export function exportFailedFeedback(error: unknown): DataTransferFeedback {
  if (error instanceof DataTransferError) {
    switch (error.code) {
      case 'export_state_invalid':
        return failure(
          `現在の保存データに整合性の問題があるため、エクスポートできませんでした。${UNCHANGED_NOTE}`,
          error.validationIssues,
        )
      case 'transaction_failed':
        return failure(`保存データを読み取れなかったため、エクスポートできませんでした。${UNCHANGED_NOTE}`)
      case 'invalid_import':
        break
    }
  }
  return failure(`エクスポート中に予期しないエラーが発生しました。${UNCHANGED_NOTE}`)
}

/** The selected file could not be read as text at all (before any JSON parse). */
export function importFileReadFailedFeedback(): DataTransferFeedback {
  return failure(`選択したファイルを読み取れませんでした。${UNCHANGED_NOTE}`)
}

/** A refused `prepareImportJson()`: nothing was written and no confirmation is asked. */
export function importPreparationFailedFeedback(
  result: Extract<ImportPreparationResult, { ok: false }>,
): DataTransferFeedback {
  switch (result.code) {
    case 'invalid_json':
      return failure(`選択したファイルをJSONとして読み取れませんでした。${UNCHANGED_NOTE}`, result.issues)
    case 'invalid_import':
      return failure(
        `このバックアップファイルはインポートできません。インポートできないデータが含まれているか、保存形式が現在のアプリで読み込めません。${UNCHANGED_NOTE}`,
        result.issues,
      )
  }
}

export function importSucceededFeedback(): DataTransferFeedback {
  return success(dataTransferSuccessMessages.import)
}

/** A failed `applyImport()`: the transaction rolled back, so the previous data stays. */
export function importApplyFailedFeedback(error: unknown): DataTransferFeedback {
  if (error instanceof DataTransferError) {
    switch (error.code) {
      case 'invalid_import':
        return failure(`このバックアップファイルはインポートできません。${UNCHANGED_NOTE}`, error.validationIssues)
      case 'transaction_failed':
        return failure(`データをインポートできませんでした。${UNCHANGED_NOTE}`)
      case 'export_state_invalid':
        break
    }
  }
  return failure(`インポート中に予期しないエラーが発生しました。${UNCHANGED_NOTE}`)
}

export function clearSucceededFeedback(): DataTransferFeedback {
  return success(dataTransferSuccessMessages.clear)
}

/** A failed `clearAllData()`: the transaction rolled back, so the previous data stays. */
export function clearFailedFeedback(): DataTransferFeedback {
  return failure(`データを削除できませんでした。${UNCHANGED_NOTE}`)
}

/**
 * Saves JSON text as a file through the browser only: a UTF-8 JSON Blob, an
 * object URL and a `download` anchor. The object URL is released once the
 * click was dispatched; no data is sent anywhere.
 */
export function downloadJsonFile(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    try {
      anchor.click()
    } finally {
      anchor.remove()
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
