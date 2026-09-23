import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  backupFilename,
  exportCopyFailedFeedback,
  importPreparationFailedFeedback,
  writeClipboardText,
} from './dataTransferPresentation'

describe('backupFilename', () => {
  it('names the file gogma-artian-planner-backup_yyyyMMddHHmmss.json in local time with zero padding', () => {
    expect(backupFilename(new Date(2026, 0, 2, 3, 4, 5))).toBe('gogma-artian-planner-backup_20260102030405.json')
    expect(backupFilename(new Date(2026, 8, 23, 13, 5, 42))).toBe('gogma-artian-planner-backup_20260923130542.json')
    expect(backupFilename(new Date(2026, 11, 31, 23, 59, 59))).toBe('gogma-artian-planner-backup_20261231235959.json')
  })

  it('uses no character a filesystem path treats specially', () => {
    const name = backupFilename(new Date(2026, 8, 23, 0, 0, 0))
    expect(name).toMatch(/^gogma-artian-planner-backup_\d{14}\.json$/)
    expect(name).not.toMatch(/[:/\\]/)
  })
})

describe('writeClipboardText', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('writes the given text through the asynchronous Clipboard API', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await writeClipboardText('{\n  "a": 1\n}')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}')
  })

  it('rejects when the Clipboard API is unavailable or refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    await expect(writeClipboardText('x')).rejects.toThrow()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError') }) },
    })
    await expect(writeClipboardText('x')).rejects.toThrow()
  })
})

describe('feedback sentences', () => {
  it('sends a copy failure to the JSON field without a browser error', () => {
    expect(exportCopyFailedFeedback()).toEqual({
      severity: 'error',
      message: 'クリップボードにコピーできませんでした。JSON欄から手動でコピーしてください。',
      issues: [],
    })
  })

  it('names the Import source a refusal came from', () => {
    const invalidJson = { ok: false as const, code: 'invalid_json' as const, issues: [] }
    const invalidImport = { ok: false as const, code: 'invalid_import' as const, issues: [] }
    expect(importPreparationFailedFeedback(invalidJson, 'paste').message).toMatch(/^貼り付けた内容をJSONとして読み取れませんでした。/)
    expect(importPreparationFailedFeedback(invalidJson, 'file').message).toMatch(/^選択したファイルをJSONとして読み取れませんでした。/)
    expect(importPreparationFailedFeedback(invalidImport, 'paste').message).toMatch(/^このバックアップデータはインポートできません。/)
    expect(importPreparationFailedFeedback(invalidImport, 'file').message).toMatch(/^このバックアップファイルはインポートできません。/)
  })
})
