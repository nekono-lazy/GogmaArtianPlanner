import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, ExportRoot } from '../domain/models/publicTypes'
import { createDefaultAppSettings, EXPORT_APP_NAME, EXPORT_SCHEMA_VERSION } from '../domain/models/publicTypes'
import type { DataTransferBrowserAdapter } from '../components/settings/dataTransferPresentation'
import { DataTransferError, type ImportPreparationResult } from '../services/dataTransfer/importExportService'
import { useSettingsStore } from '../stores/settingsStore'
import { hasMaxHeightRule } from '../test/cssRuleAssertions'
import { SettingsPage, type SettingsPageDependencies } from './SettingsPage'

/*
 * The Settings screen's data management UI (`docs/UI_FLOW.md` 14 / 19.3). The
 * Service is the injected boundary: these tests prove the wiring, the
 * confirmations, the busy control and the Settings Store rehydrate, and never
 * re-prove the Service's own validation, migration or rollback semantics.
 */

function settingsWith(debugMode: boolean): AppSettings {
  return { ...createDefaultAppSettings('2026-09-22T00:00:00.000Z'), debugMode, updatedAt: '2026-09-22T00:00:00.000Z' }
}

function exportRootWith(debugMode: boolean): ExportRoot {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appName: EXPORT_APP_NAME,
    exportedAt: '2026-09-21T12:00:00.000Z',
    rngState: null,
    normalArtianCounters: [],
    ownedWeapons: [],
    targetWeapons: [],
    buildCandidates: [],
    buildListEntries: [],
    productionPlans: [],
    executionHistory: [],
    executionSavePoints: [],
    settings: settingsWith(debugMode),
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function dependencies(overrides: Partial<SettingsPageDependencies> = {}) {
  return {
    serializeExport: vi.fn(async () => JSON.stringify(exportRootWith(false))),
    prepareImportJson: vi.fn((json: string): ImportPreparationResult => ({ ok: true, root: JSON.parse(json) as ExportRoot })),
    applyImport: vi.fn(async () => undefined),
    clearAllData: vi.fn(async () => settingsWith(false)),
    saveDebugMode: vi.fn(async () => settingsWith(true)),
    ...overrides,
  } satisfies SettingsPageDependencies
}

function browserAdapter(overrides: Partial<DataTransferBrowserAdapter> = {}) {
  return {
    writeClipboardText: vi.fn<(text: string) => Promise<undefined>>(async () => undefined),
    now: vi.fn(() => new Date(2026, 8, 3, 4, 5, 6)),
    ...overrides,
  } satisfies DataTransferBrowserAdapter
}

function backupFile(content: string, name = 'backup.json'): File {
  return new File([content], name, { type: 'application/json' })
}

/** The human-readable JSON the Service returns; the Dialog must show it byte for byte. */
const exportedJson = `${JSON.stringify(exportRootWith(false), null, 2)}\n`

/**
 * A disabled MUI Button has `pointer-events: none`; the busy tests click one on
 * purpose to prove nothing runs, so the pointer-events check is off. A
 * disabled control still receives no click event.
 */
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 })

const fileInput = () => screen.getByLabelText('バックアップファイルを選択')
// While a Dialog is open MUI hides the page behind it from the accessibility
// tree, so the page controls are queried with `hidden` where a Dialog is up.
const exportButton = (hidden = false) => screen.getByRole('button', { name: 'データをエクスポート', hidden })
const importButton = (hidden = false) => screen.getByRole('button', { name: 'データをインポート', hidden })
const clearButton = (hidden = false) => screen.getByRole('button', { name: '全データを削除', hidden })
const debugSwitch = (hidden = false) => screen.getByRole('switch', { name: 'デバッグモード', hidden })
const noDialog = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
const exportDialog = () => screen.findByRole('dialog', { name: 'バックアップデータ' })
const importDialog = () => screen.findByRole('dialog', { name: 'バックアップデータを読み込む' })
const confirmDialog = () => screen.findByRole('dialog', { name: 'バックアップからデータを復元しますか？' })
const jsonField = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: 'バックアップJSON' }) as HTMLTextAreaElement
const readDraftButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: '貼り付けた内容を読み込む' })

type User = ReturnType<typeof userEvent.setup>

async function openImport(user: User): Promise<HTMLElement> {
  await user.click(importButton())
  return importDialog()
}

/** Opens the Import Dialog when needed and picks a file through 「ファイルから読み込む」's input. */
async function selectBackup(user: User, content: string | File) {
  if (screen.queryByRole('dialog', { name: 'バックアップデータを読み込む' }) === null) await openImport(user)
  await user.upload(fileInput(), typeof content === 'string' ? backupFile(content) : content)
}

function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    return false
  }
}

/**
 * The values an emitted style rule matching the element declares for a property.
 * jsdom lets MUI's `font: inherit` shorthand win the cascade over a more specific
 * `font-family`, so the emitted rule is checked instead of the computed value;
 * selectors jsdom cannot parse (vendor pseudo-elements) are skipped.
 */
function declaredValues(element: Element, property: string): string[] {
  const values: string[] = []
  const visit = (rule: CSSRule) => {
    if (rule instanceof CSSGroupingRule) [...rule.cssRules].forEach(visit)
    if (!(rule instanceof CSSStyleRule)) return
    const value = rule.style.getPropertyValue(property)
    if (value !== '' && safeMatches(element, rule.selectorText)) values.push(value)
  }
  for (const sheet of [...document.styleSheets]) [...sheet.cssRules].forEach(visit)
  return values
}

/** The JSON field wraps long tokens and scrolls inside itself instead of widening the Dialog. */
function expectScrollingMonospaceField(field: HTMLTextAreaElement) {
  expect(declaredValues(field, 'font-family').some((value) => value.endsWith('monospace'))).toBe(true)
  const style = getComputedStyle(field)
  expect(style.overflowY).toBe('auto')
  expect(style.overflowWrap).toBe('anywhere')
  expect(style.whiteSpace).toBe('pre-wrap')
}

async function pasteDraft(user: User, dialog: HTMLElement, text: string) {
  await user.click(jsonField(dialog))
  await user.paste(text)
}

describe('SettingsPage data management', () => {
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-backup')
  const revokeObjectURL = vi.fn()
  let anchorClick: ReturnType<typeof vi.spyOn>
  let clickedAnchors: HTMLAnchorElement[]

  beforeEach(() => {
    useSettingsStore.getState().reset()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    clickedAnchors = []
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL })
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchors.push(this)
    })
  })

  afterEach(() => {
    anchorClick.mockRestore()
  })

  it('shows the data management section with its three controls and the version information', () => {
    render(<SettingsPage dependencies={dependencies()} />)
    expect(screen.getByRole('heading', { name: 'データ管理' })).toBeInTheDocument()
    expect(exportButton()).toBeEnabled()
    expect(importButton()).toBeEnabled()
    expect(clearButton()).toBeEnabled()
    expect(screen.getByText(/RNG状態、通常アーティアCounter、所持武器、目標武器/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'バージョン情報' })).toBeInTheDocument()
    expect(screen.getByText(/データのバックアップと復元/)).toBeInTheDocument()
  })

  describe('Export', () => {
    it('serializes once and opens the Export Dialog with the exact JSON, without downloading', async () => {
      const user = setupUser()
      const deps = dependencies({ serializeExport: vi.fn(async () => exportedJson) })
      render(<SettingsPage dependencies={deps} browser={browserAdapter()} />)
      await user.click(exportButton())
      const dialog = await exportDialog()
      expect(dialog).toHaveAttribute('aria-labelledby')
      expect(dialog).toHaveAttribute('aria-describedby')
      expect(dialog).toHaveTextContent('このJSONにはアプリのユーザーデータが含まれています。')
      const field = jsonField(dialog)
      expect(field.tagName).toBe('TEXTAREA')
      expect(field).toHaveAttribute('readonly')
      expect(field.value).toBe(exportedJson)
      expectScrollingMonospaceField(field)
      expect(deps.serializeExport).toHaveBeenCalledTimes(1)
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(clickedAnchors).toHaveLength(0)
      expect(within(dialog).queryByRole('alert')).toBeNull()
      expect(screen.queryByText('バックアップファイルを出力しました。')).toBeNull()
      expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeEnabled()
      expect(within(dialog).getByRole('button', { name: 'コピー' })).toBeEnabled()
      expect(within(dialog).getByRole('button', { name: 'ファイル出力' })).toBeEnabled()
      expect(deps.applyImport).not.toHaveBeenCalled()
      expect(deps.clearAllData).not.toHaveBeenCalled()
    })

    it('copies the shown JSON once and reports the copy inside the Dialog', async () => {
      const user = setupUser()
      const copy = deferred<undefined>()
      const browser = browserAdapter({ writeClipboardText: vi.fn(() => copy.promise) })
      const deps = dependencies({ serializeExport: vi.fn(async () => exportedJson) })
      render(<SettingsPage dependencies={deps} browser={browser} />)
      await user.click(exportButton())
      const dialog = await exportDialog()
      await user.click(within(dialog).getByRole('button', { name: 'コピー' }))
      const busy = within(dialog).getByRole('button', { name: 'コピー中…' })
      expect(busy).toBeDisabled()
      await user.click(busy)
      expect(browser.writeClipboardText).toHaveBeenCalledTimes(1)
      expect(browser.writeClipboardText).toHaveBeenCalledWith(exportedJson)
      copy.resolve(undefined)
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('クリップボードにコピーしました。')
      expect(within(dialog).getByRole('button', { name: 'コピー' })).toBeEnabled()
      expect(deps.serializeExport).toHaveBeenCalledTimes(1)
      expect(createObjectURL).not.toHaveBeenCalled()
    })

    it.each([
      ['rejects', vi.fn(async () => { throw new DOMException('Document is not focused.', 'NotAllowedError') })],
      ['throws', vi.fn(() => { throw new TypeError('clipboard.writeText is not a function') })],
    ])('keeps the Dialog and points to manual copy when the clipboard write %s, without the browser error', async (_, writeClipboardText) => {
      const user = setupUser()
      const deps = dependencies({ serializeExport: vi.fn(async () => exportedJson) })
      render(<SettingsPage dependencies={deps} browser={browserAdapter({ writeClipboardText })} />)
      await user.click(exportButton())
      const dialog = await exportDialog()
      await user.click(within(dialog).getByRole('button', { name: 'コピー' }))
      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent('クリップボードにコピーできませんでした。JSON欄から手動でコピーしてください。')
      expect(screen.queryByText(/not focused|not a function|NotAllowedError/)).toBeNull()
      expect(jsonField(dialog).value).toBe(exportedJson)
      expect(screen.getByRole('dialog', { name: 'バックアップデータ' })).toBeInTheDocument()
      expect(deps.serializeExport).toHaveBeenCalledTimes(1)
      expect(deps.applyImport).not.toHaveBeenCalled()
      expect(deps.clearAllData).not.toHaveBeenCalled()
    })

    it('saves the same JSON as a timestamped file, reuses it for every output and releases the object URL', async () => {
      const user = setupUser()
      const browser = browserAdapter()
      const deps = dependencies({ serializeExport: vi.fn(async () => exportedJson) })
      render(<SettingsPage dependencies={deps} browser={browser} />)
      await user.click(exportButton())
      const dialog = await exportDialog()
      await user.click(within(dialog).getByRole('button', { name: 'ファイル出力' }))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('バックアップファイルを出力しました。')
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0][0]
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toContain('application/json')
      expect(await blob.text()).toBe(exportedJson)
      expect(clickedAnchors).toHaveLength(1)
      expect(clickedAnchors[0].download).toBe('gogma-artian-planner-backup_20260903040506.json')
      expect(clickedAnchors[0].href).toBe('blob:mock-backup')
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-backup')

      await user.click(within(dialog).getByRole('button', { name: 'コピー' }))
      await within(dialog).findByText('クリップボードにコピーしました。')
      await user.click(within(dialog).getByRole('button', { name: 'ファイル出力' }))
      expect(createObjectURL).toHaveBeenCalledTimes(2)
      expect(await createObjectURL.mock.calls[1][0].text()).toBe(exportedJson)
      expect(clickedAnchors[1].download).toBe('gogma-artian-planner-backup_20260903040506.json')
      expect(browser.writeClipboardText).toHaveBeenCalledWith(exportedJson)
      expect(browser.now).toHaveBeenCalledTimes(1)
      expect(deps.serializeExport).toHaveBeenCalledTimes(1)
    })

    it('reports a refused download inside the Dialog and keeps the JSON', async () => {
      const user = setupUser()
      createObjectURL.mockImplementationOnce(() => {
        throw new Error('blocked')
      })
      render(<SettingsPage dependencies={dependencies({ serializeExport: vi.fn(async () => exportedJson) })} browser={browserAdapter()} />)
      await user.click(exportButton())
      const dialog = await exportDialog()
      await user.click(within(dialog).getByRole('button', { name: 'ファイル出力' }))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('バックアップファイルを出力できませんでした。')
      expect(screen.queryByText(/blocked/)).toBeNull()
      expect(jsonField(dialog).value).toBe(exportedJson)
    })

    it('closes with 閉じる, and the next Export serializes a new snapshot with fresh feedback and filename', async () => {
      const user = setupUser()
      const browser = browserAdapter({
        now: vi.fn<() => Date>().mockReturnValueOnce(new Date(2026, 8, 3, 4, 5, 6)).mockReturnValueOnce(new Date(2026, 8, 3, 4, 7, 0)),
      })
      const deps = dependencies({
        serializeExport: vi.fn<() => Promise<string>>().mockResolvedValueOnce(exportedJson).mockResolvedValueOnce('{\n  "second": true\n}\n'),
      })
      render(<SettingsPage dependencies={deps} browser={browser} />)
      await user.click(exportButton())
      let dialog = await exportDialog()
      await user.click(within(dialog).getByRole('button', { name: 'コピー' }))
      await within(dialog).findByText('クリップボードにコピーしました。')
      await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
      await noDialog()
      expect(screen.queryByText('クリップボードにコピーしました。')).toBeNull()
      await user.click(exportButton())
      dialog = await exportDialog()
      expect(deps.serializeExport).toHaveBeenCalledTimes(2)
      expect(jsonField(dialog).value).toBe('{\n  "second": true\n}\n')
      expect(within(dialog).queryByRole('alert')).toBeNull()
      await user.click(within(dialog).getByRole('button', { name: 'ファイル出力' }))
      expect(clickedAnchors[0].download).toBe('gogma-artian-planner-backup_20260903040700.json')
    })

    it('reports an invalid current state with its issues, no Dialog and no download', async () => {
      const user = setupUser()
      const deps = dependencies({
        serializeExport: vi.fn(async () => {
          throw new DataTransferError('export_state_invalid', 'invalid', {
            validationIssues: [{ path: 'targetWeapons[0].idealBonuses', code: 'invalid_reference', message: 'Unknown bonus type.' }],
          })
        }),
      })
      render(<SettingsPage dependencies={deps} browser={browserAdapter()} />)
      await user.click(exportButton())
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('現在の保存データに整合性の問題があるため、エクスポートできませんでした。')
      expect(alert).toHaveTextContent('保存済みデータは変更されていません。')
      const issues = within(alert).getByRole('list', { name: '検出された問題' })
      expect(within(issues).getByRole('listitem')).toHaveTextContent('targetWeapons[0].idealBonuses: Unknown bonus type.')
      expect(hasMaxHeightRule(issues)).toBe(true)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(clickedAnchors).toHaveLength(0)
      expect(screen.queryByText('バックアップファイルを出力しました。')).toBeNull()
      expect(exportButton()).toBeEnabled()
    })

    it('reports a read failure and an unexpected failure without a stack trace or a Dialog', async () => {
      const user = setupUser()
      const deps = dependencies({
        serializeExport: vi
          .fn<() => Promise<string>>()
          .mockRejectedValueOnce(new DataTransferError('transaction_failed', 'read failed'))
          .mockRejectedValueOnce(new Error('boom stack')),
      })
      render(<SettingsPage dependencies={deps} />)
      await user.click(exportButton())
      await screen.findByText(/保存データを読み取れなかったため、エクスポートできませんでした。/)
      await user.click(exportButton())
      await screen.findByText(/エクスポート中に予期しないエラーが発生しました。/)
      expect(screen.queryByText(/boom stack/)).toBeNull()
      expect(screen.getAllByRole('alert')).toHaveLength(1)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('Import by paste', () => {
    it('opens the Import Dialog with an editable multiline field, and reading stays unavailable while it is blank', async () => {
      const user = setupUser()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      const dialog = await openImport(user)
      expect(dialog).toHaveAttribute('aria-labelledby')
      expect(dialog).toHaveAttribute('aria-describedby')
      const field = jsonField(dialog)
      expect(field.tagName).toBe('TEXTAREA')
      expect(field).not.toHaveAttribute('readonly')
      expect(field.value).toBe('')
      expectScrollingMonospaceField(field)
      expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeEnabled()
      expect(within(dialog).getByRole('button', { name: 'ファイルから読み込む' })).toBeEnabled()
      expect(readDraftButton(dialog)).toBeDisabled()
      await pasteDraft(user, dialog, '  \n\t ')
      expect(readDraftButton(dialog)).toBeDisabled()
      await user.click(readDraftButton(dialog))
      expect(deps.prepareImportJson).not.toHaveBeenCalled()
    })

    it('hands the pasted text exactly to prepareImportJson and replaces the input Dialog with the confirmation', async () => {
      const user = setupUser()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      const dialog = await openImport(user)
      const pasted = `  ${JSON.stringify(exportRootWith(true), null, 2)}\n`
      await pasteDraft(user, dialog, pasted)
      expect(jsonField(dialog).value).toBe(pasted)
      await user.click(readDraftButton(dialog))
      const confirm = await confirmDialog()
      expect(deps.prepareImportJson).toHaveBeenCalledTimes(1)
      expect(deps.prepareImportJson).toHaveBeenCalledWith(pasted)
      expect(confirm).toHaveTextContent('このインポートは全置換です。')
      expect(confirm).toHaveTextContent('バックアップ作成日時: 2026-09-21T12:00:00.000Z')
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'バックアップデータを読み込む' })).toBeNull())
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(deps.applyImport).not.toHaveBeenCalled()
    })

    it.each([
      ['invalid_json' as const, '貼り付けた内容をJSONとして読み取れませんでした。', 'JSONとして読み取れません: bad'],
      ['invalid_import' as const, 'このバックアップデータはインポートできません。', 'schemaVersion: Unsupported schemaVersion.'],
    ])('keeps the Dialog and the draft on %s, shows the issues inside it and applies nothing, then reads again', async (code, message, issueText) => {
      const user = setupUser()
      const issue = code === 'invalid_json'
        ? { path: '', code: 'invalid_structure' as const, message: 'JSONとして読み取れません: bad' }
        : { path: 'schemaVersion', code: 'invalid_literal' as const, message: 'Unsupported schemaVersion.' }
      const deps = dependencies({
        prepareImportJson: vi
          .fn<(json: string) => ImportPreparationResult>()
          .mockReturnValueOnce({ ok: false, code, issues: [issue] })
          .mockReturnValueOnce({ ok: true, root: exportRootWith(false) }),
      })
      render(<SettingsPage dependencies={deps} />)
      const dialog = await openImport(user)
      await pasteDraft(user, dialog, '{not json')
      await user.click(readDraftButton(dialog))
      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(alert).toHaveTextContent('保存済みデータは変更されていません。')
      const issues = within(alert).getByRole('list', { name: '検出された問題' })
      expect(within(issues).getByRole('listitem')).toHaveTextContent(issueText)
      expect(hasMaxHeightRule(issues)).toBe(true)
      expect(jsonField(dialog).value).toBe('{not json')
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(deps.applyImport).not.toHaveBeenCalled()
      expect(useSettingsStore.getState().isHydrated).toBe(false)

      await pasteDraft(user, dialog, '}')
      await user.click(readDraftButton(dialog))
      await confirmDialog()
      expect(deps.prepareImportJson).toHaveBeenNthCalledWith(2, '{not json}')
    })

    it('reports a preparation that threw inside the Dialog without its message', async () => {
      const user = setupUser()
      const deps = dependencies({ prepareImportJson: vi.fn(() => { throw new Error('boom stack') }) })
      render(<SettingsPage dependencies={deps} />)
      const dialog = await openImport(user)
      await pasteDraft(user, dialog, '{}')
      await user.click(readDraftButton(dialog))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('貼り付けた内容を確認できませんでした。')
      expect(screen.queryByText(/boom stack/)).toBeNull()
      expect(jsonField(dialog).value).toBe('{}')
      expect(readDraftButton(dialog)).toBeEnabled()
    })

    it('closes with 閉じる without preparing anything and starts empty next time', async () => {
      const user = setupUser()
      const deps = dependencies({
        prepareImportJson: vi.fn((): ImportPreparationResult => ({ ok: false, code: 'invalid_json', issues: [] })),
      })
      render(<SettingsPage dependencies={deps} />)
      let dialog = await openImport(user)
      await pasteDraft(user, dialog, '{not json')
      await user.click(readDraftButton(dialog))
      await within(dialog).findByRole('alert')
      await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
      await noDialog()
      expect(deps.prepareImportJson).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).toBeNull()
      dialog = await openImport(user)
      expect(jsonField(dialog).value).toBe('')
      expect(within(dialog).queryByRole('alert')).toBeNull()
      expect(deps.applyImport).not.toHaveBeenCalled()
    })
  })

  describe('Import by file', () => {
    it('opens the file picker from ファイルから読み込む and accepts JSON files', async () => {
      const user = setupUser()
      render(<SettingsPage dependencies={dependencies()} />)
      const dialog = await openImport(user)
      const input = fileInput()
      expect(input).toHaveAttribute('type', 'file')
      expect(input).toHaveAttribute('accept', '.json,application/json')
      const inputClick = vi.spyOn(input, 'click')
      await user.click(within(dialog).getByRole('button', { name: 'ファイルから読み込む' }))
      expect(inputClick).toHaveBeenCalledTimes(1)
    })

    it('hands the file text exactly to prepareImportJson and opens the full-replacement confirmation at once', async () => {
      const user = setupUser()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      const dialog = await openImport(user)
      await pasteDraft(user, dialog, '{"ignored": "draft"}')
      const json = JSON.stringify(exportRootWith(true))
      await selectBackup(user, json)
      const confirm = await confirmDialog()
      expect(deps.prepareImportJson).toHaveBeenCalledTimes(1)
      expect(deps.prepareImportJson).toHaveBeenCalledWith(json)
      expect(confirm).toHaveTextContent('このインポートは全置換です。現在保存されているデータは、読み込んだバックアップの内容に置き換わります。')
      expect(confirm).toHaveTextContent('必要な場合は、実行前に現在のデータをエクスポートしてください。')
      expect(confirm).toHaveAttribute('aria-labelledby')
      expect(confirm).toHaveAttribute('aria-describedby')
      await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
      expect(deps.applyImport).not.toHaveBeenCalled()
    })

    it.each([
      ['invalid_json' as const, '選択したファイルをJSONとして読み取れませんでした。', 'JSONとして読み取れません: bad'],
      ['invalid_import' as const, 'このバックアップファイルはインポートできません。', 'schemaVersion: Unsupported schemaVersion.'],
    ])('keeps the Import Dialog on %s with the issues inside it and no apply', async (code, message, issueText) => {
      const user = setupUser()
      const issue = code === 'invalid_json'
        ? { path: '', code: 'invalid_structure' as const, message: 'JSONとして読み取れません: bad' }
        : { path: 'schemaVersion', code: 'invalid_literal' as const, message: 'Unsupported schemaVersion.' }
      const deps = dependencies({
        prepareImportJson: vi.fn((): ImportPreparationResult => ({ ok: false, code, issues: [issue] })),
      })
      render(<SettingsPage dependencies={deps} />)
      await selectBackup(user, '{not json')
      const dialog = await importDialog()
      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(within(alert).getByRole('listitem')).toHaveTextContent(issueText)
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(deps.applyImport).not.toHaveBeenCalled()
      expect(useSettingsStore.getState().isHydrated).toBe(false)
    })

    it('reports an unreadable file inside the Dialog and keeps the pasted draft', async () => {
      const user = setupUser()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      const dialog = await openImport(user)
      await pasteDraft(user, dialog, '{"draft": 1}')
      const unreadable = backupFile('{}')
      Object.defineProperty(unreadable, 'text', { value: () => Promise.reject(new Error('io failure')) })
      await selectBackup(user, unreadable)
      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent('選択したファイルを読み取れませんでした。保存済みデータは変更されていません。')
      expect(screen.queryByText(/io failure/)).toBeNull()
      expect(jsonField(dialog).value).toBe('{"draft": 1}')
      expect(deps.prepareImportJson).not.toHaveBeenCalled()
      expect(within(dialog).getByRole('button', { name: 'ファイルから読み込む' })).toBeEnabled()
    })

    it('lets the same file be selected again after a refusal', async () => {
      const user = setupUser()
      const deps = dependencies({
        prepareImportJson: vi
          .fn<(json: string) => ImportPreparationResult>()
          .mockReturnValueOnce({ ok: false, code: 'invalid_json', issues: [] })
          .mockReturnValueOnce({ ok: true, root: exportRootWith(false) }),
      })
      render(<SettingsPage dependencies={deps} />)
      await selectBackup(user, '{not json')
      const dialog = await importDialog()
      await within(dialog).findByRole('alert')
      expect((fileInput() as HTMLInputElement).value).toBe('')
      await selectBackup(user, '{not json')
      await confirmDialog()
      expect(deps.prepareImportJson).toHaveBeenCalledTimes(2)
    })
  })

  describe('Import confirmation and apply', () => {
    it('cancels without applying and keeps the store untouched', async () => {
      const user = setupUser()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      await selectBackup(user, JSON.stringify(exportRootWith(true)))
      await screen.findByRole('dialog')
      await user.click(screen.getByRole('button', { name: 'キャンセル' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(deps.applyImport).not.toHaveBeenCalled()
      expect(useSettingsStore.getState().debugMode).toBe(false)
      expect(useSettingsStore.getState().isHydrated).toBe(false)
    })

    it('applies the prepared root once on confirm, hydrates the imported settings and reports success', async () => {
      const user = setupUser()
      const apply = deferred<void>()
      const deps = dependencies({ applyImport: vi.fn(() => apply.promise) })
      render(<SettingsPage dependencies={deps} />)
      const root = exportRootWith(true)
      await selectBackup(user, JSON.stringify(root))
      const dialog = await screen.findByRole('dialog')
      const confirm = within(dialog).getByRole('button', { name: '現在のデータを置き換えてインポート' })
      await user.click(confirm)
      await user.click(confirm)
      expect(deps.applyImport).toHaveBeenCalledTimes(1)
      expect(deps.applyImport).toHaveBeenCalledWith(root)
      expect(confirm).toBeDisabled()
      expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeDisabled()
      expect(useSettingsStore.getState().debugMode).toBe(false)
      apply.resolve()
      await screen.findByText('データをインポートしました。')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(useSettingsStore.getState()).toMatchObject({ debugMode: true, isHydrated: true })
      expect(debugSwitch()).toBeChecked()
    })

    it('hydrates an imported debugMode = false over a Debug Mode that was on', async () => {
      const user = setupUser()
      useSettingsStore.getState().hydrate(settingsWith(true))
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      expect(debugSwitch()).toBeChecked()
      await selectBackup(user, JSON.stringify(exportRootWith(false)))
      await user.click(await screen.findByRole('button', { name: '現在のデータを置き換えてインポート' }))
      await screen.findByText('データをインポートしました。')
      await noDialog()
      expect(useSettingsStore.getState().debugMode).toBe(false)
      expect(debugSwitch()).not.toBeChecked()
    })

    it('reports a failed apply without hydrating and without a success message', async () => {
      const user = setupUser()
      const deps = dependencies({
        applyImport: vi.fn(async () => {
          throw new DataTransferError('transaction_failed', 'rolled back')
        }),
      })
      render(<SettingsPage dependencies={deps} />)
      await selectBackup(user, JSON.stringify(exportRootWith(true)))
      await user.click(await screen.findByRole('button', { name: '現在のデータを置き換えてインポート' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('データをインポートできませんでした。保存済みデータは変更されていません。')
      expect(screen.queryByText('データをインポートしました。')).toBeNull()
      expect(useSettingsStore.getState()).toMatchObject({ debugMode: false, isHydrated: false })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(importButton()).toBeEnabled()
    })

    it('shows the re-validation issues of an apply refused as invalid_import', async () => {
      const user = setupUser()
      const deps = dependencies({
        applyImport: vi.fn(async () => {
          throw new DataTransferError('invalid_import', 'refused', {
            validationIssues: [{ path: 'ownedWeapons[0].weaponTypeId', code: 'invalid_reference', message: 'Unknown weapon type.' }],
          })
        }),
      })
      render(<SettingsPage dependencies={deps} />)
      await selectBackup(user, JSON.stringify(exportRootWith(true)))
      await user.click(await screen.findByRole('button', { name: '現在のデータを置き換えてインポート' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('このバックアップファイルはインポートできません。')
      expect(within(alert).getByRole('listitem')).toHaveTextContent('ownedWeapons[0].weaponTypeId: Unknown weapon type.')
      expect(useSettingsStore.getState().isHydrated).toBe(false)
    })
  })

  describe('Clear all data', () => {
    it('confirms before clearing and cancels without calling the service', async () => {
      const user = setupUser()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      await user.click(clearButton())
      const dialog = await screen.findByRole('dialog', { name: 'すべてのデータを削除しますか？' })
      expect(dialog).toHaveTextContent('この操作は元に戻せません。')
      expect(dialog).toHaveTextContent('必要な場合は先にエクスポートしてください。')
      expect(dialog).toHaveAttribute('aria-describedby')
      await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(deps.clearAllData).not.toHaveBeenCalled()
    })

    it('clears once on confirm, hydrates the returned default settings and reports success', async () => {
      const user = setupUser()
      useSettingsStore.getState().hydrate(settingsWith(true))
      const clear = deferred<AppSettings>()
      const deps = dependencies({ clearAllData: vi.fn(() => clear.promise) })
      render(<SettingsPage dependencies={deps} />)
      expect(debugSwitch()).toBeChecked()
      await user.click(clearButton())
      const dialog = await screen.findByRole('dialog')
      const confirm = within(dialog).getByRole('button', { name: 'すべてのデータを削除' })
      await user.click(confirm)
      await user.click(confirm)
      expect(deps.clearAllData).toHaveBeenCalledTimes(1)
      expect(confirm).toBeDisabled()
      expect(useSettingsStore.getState().debugMode).toBe(true)
      clear.resolve(settingsWith(false))
      await screen.findByText('すべてのデータを削除し、初期状態に戻しました。')
      await noDialog()
      expect(useSettingsStore.getState()).toMatchObject({ debugMode: false, isHydrated: true })
      expect(debugSwitch()).not.toBeChecked()
    })

    it('keeps the store on a failed clear and reports that nothing changed', async () => {
      const user = setupUser()
      useSettingsStore.getState().hydrate(settingsWith(true))
      const deps = dependencies({
        clearAllData: vi.fn(async () => {
          throw new DataTransferError('transaction_failed', 'rolled back')
        }),
      })
      render(<SettingsPage dependencies={deps} />)
      await user.click(clearButton())
      await user.click(await screen.findByRole('button', { name: 'すべてのデータを削除' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('データを削除できませんでした。保存済みデータは変更されていません。')
      expect(screen.queryByText('すべてのデータを削除し、初期状態に戻しました。')).toBeNull()
      expect(useSettingsStore.getState()).toMatchObject({ debugMode: true, isHydrated: true })
      await noDialog()
      expect(debugSwitch()).toBeChecked()
    })
  })

  describe('busy control', () => {
    it('disables every data control and the Debug Mode switch while an Import applies', async () => {
      const user = setupUser()
      const apply = deferred<void>()
      const deps = dependencies({ applyImport: vi.fn(() => apply.promise) })
      render(<SettingsPage dependencies={deps} />)
      await selectBackup(user, JSON.stringify(exportRootWith(true)))
      await user.click(await screen.findByRole('button', { name: '現在のデータを置き換えてインポート' }))
      expect(screen.getByRole('button', { name: 'インポート中…', hidden: true })).toBeDisabled()
      expect(exportButton(true)).toBeDisabled()
      expect(clearButton(true)).toBeDisabled()
      // The file picker lives in the Import Dialog, which closed for the confirmation.
      await waitFor(() => expect(screen.queryByLabelText('バックアップファイルを選択')).toBeNull())
      expect(debugSwitch(true)).toBeDisabled()
      await user.click(exportButton(true))
      await user.click(clearButton(true))
      await user.click(debugSwitch(true))
      expect(deps.serializeExport).not.toHaveBeenCalled()
      expect(deps.saveDebugMode).not.toHaveBeenCalled()
      expect(deps.applyImport).toHaveBeenCalledTimes(1)
      apply.resolve()
      await screen.findByText('データをインポートしました。')
      await noDialog()
      expect(exportButton()).toBeEnabled()
      expect(debugSwitch()).toBeEnabled()
    })

    it('runs one file preparation at a time: while the file is read no paste or file read starts and 閉じる waits', async () => {
      const user = setupUser()
      const read = deferred<string>()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      const dialog = await openImport(user)
      await pasteDraft(user, dialog, '{"draft": 1}')
      const slow = backupFile('{}')
      Object.defineProperty(slow, 'text', { value: () => read.promise })
      await selectBackup(user, slow)
      const busy = within(dialog).getByRole('button', { name: '確認中…' })
      expect(busy).toBeDisabled()
      expect(within(dialog).getByRole('button', { name: 'ファイルから読み込む' })).toBeDisabled()
      expect(within(dialog).getByRole('button', { name: '閉じる' })).toBeDisabled()
      expect(fileInput()).toBeDisabled()
      expect(debugSwitch(true)).toBeDisabled()
      await user.click(busy)
      await user.keyboard('{Escape}')
      expect(screen.getByRole('dialog', { name: 'バックアップデータを読み込む' })).toBeInTheDocument()
      expect(deps.prepareImportJson).not.toHaveBeenCalled()
      const json = JSON.stringify(exportRootWith(true))
      read.resolve(json)
      await confirmDialog()
      expect(deps.prepareImportJson).toHaveBeenCalledTimes(1)
      expect(deps.prepareImportJson).toHaveBeenCalledWith(json)
    })

    it('does not start a paste or file preparation while a Debug Mode save is pending', async () => {
      const user = setupUser()
      const save = deferred<AppSettings>()
      const deps = dependencies({ saveDebugMode: vi.fn(() => save.promise) })
      render(<SettingsPage dependencies={deps} />)
      await user.click(debugSwitch())
      expect(importButton()).toBeDisabled()
      await user.click(importButton())
      expect(screen.queryByRole('dialog')).toBeNull()
      save.resolve(settingsWith(true))
      await waitFor(() => expect(importButton()).toBeEnabled())
      const dialog = await openImport(user)
      await pasteDraft(user, dialog, '{}')
      expect(readDraftButton(dialog)).toBeEnabled()
      expect(within(dialog).getByRole('button', { name: 'ファイルから読み込む' })).toBeEnabled()
    })

    it('does not start a second clear or another operation while a clear runs', async () => {
      const user = setupUser()
      const clear = deferred<AppSettings>()
      const deps = dependencies({ clearAllData: vi.fn(() => clear.promise) })
      render(<SettingsPage dependencies={deps} />)
      await user.click(clearButton())
      await user.click(await screen.findByRole('button', { name: 'すべてのデータを削除' }))
      expect(screen.getByRole('button', { name: '削除中…', hidden: true })).toBeDisabled()
      expect(exportButton(true)).toBeDisabled()
      expect(importButton(true)).toBeDisabled()
      expect(debugSwitch(true)).toBeDisabled()
      await user.click(exportButton(true))
      expect(deps.serializeExport).not.toHaveBeenCalled()
      expect(deps.clearAllData).toHaveBeenCalledTimes(1)
      clear.resolve(settingsWith(false))
      await screen.findByText('すべてのデータを削除し、初期状態に戻しました。')
    })

    it('does not start a Data Transfer write while the Debug Mode save is pending', async () => {
      const user = setupUser()
      const save = deferred<AppSettings>()
      const deps = dependencies({ saveDebugMode: vi.fn(() => save.promise) })
      render(<SettingsPage dependencies={deps} />)
      await user.click(debugSwitch())
      expect(deps.saveDebugMode).toHaveBeenCalledWith(true)
      expect(useSettingsStore.getState().debugMode).toBe(true)
      expect(exportButton()).toBeDisabled()
      expect(importButton()).toBeDisabled()
      expect(clearButton()).toBeDisabled()
      await user.click(exportButton())
      await user.click(clearButton())
      expect(deps.serializeExport).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
      save.resolve(settingsWith(true))
      await waitFor(() => expect(exportButton()).toBeEnabled())
      await user.click(exportButton())
      await exportDialog()
      expect(deps.serializeExport).toHaveBeenCalledTimes(1)
    })

    it('still lets Debug Mode be toggled again while its own save is pending, and gates Data Transfer until every save settled', async () => {
      const user = setupUser()
      const first = deferred<AppSettings>()
      const second = deferred<AppSettings>()
      const deps = dependencies({
        saveDebugMode: vi.fn<(enabled: boolean) => Promise<AppSettings>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      })
      render(<SettingsPage dependencies={deps} />)
      await user.click(debugSwitch())
      await user.click(debugSwitch())
      expect(deps.saveDebugMode).toHaveBeenNthCalledWith(1, true)
      expect(deps.saveDebugMode).toHaveBeenNthCalledWith(2, false)
      expect(useSettingsStore.getState().debugMode).toBe(false)
      expect(debugSwitch()).not.toBeChecked()
      expect(exportButton()).toBeDisabled()
      first.resolve(settingsWith(true))
      await waitFor(() => expect(deps.saveDebugMode).toHaveBeenCalledTimes(2))
      expect(exportButton()).toBeDisabled()
      second.resolve(settingsWith(false))
      await waitFor(() => expect(exportButton()).toBeEnabled())
    })

    it('keeps reporting a Debug Mode save failure as before', async () => {
      const user = setupUser()
      const deps = dependencies({ saveDebugMode: vi.fn(async () => { throw new Error('write failed') }) })
      render(<SettingsPage dependencies={deps} />)
      await user.click(debugSwitch())
      await screen.findByText(/設定を保存できませんでした。/)
      expect(useSettingsStore.getState().debugMode).toBe(true)
    })
  })
})
