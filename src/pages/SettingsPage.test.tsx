import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, ExportRoot } from '../domain/models/publicTypes'
import { createDefaultAppSettings, EXPORT_APP_NAME, EXPORT_SCHEMA_VERSION } from '../domain/models/publicTypes'
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

function backupFile(content: string, name = 'backup.json'): File {
  return new File([content], name, { type: 'application/json' })
}

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

async function selectBackup(user: ReturnType<typeof userEvent.setup>, content: string) {
  await user.upload(fileInput(), backupFile(content))
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
    it('serializes once and downloads a .json Blob, then reports success', async () => {
      const user = setupUser()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      await user.click(exportButton())
      await screen.findByText('バックアップファイルをエクスポートしました。')
      expect(deps.serializeExport).toHaveBeenCalledTimes(1)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0][0]
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toContain('application/json')
      expect(await blob.text()).toBe(JSON.stringify(exportRootWith(false)))
      expect(clickedAnchors).toHaveLength(1)
      expect(clickedAnchors[0].download).toMatch(/\.json$/)
      expect(clickedAnchors[0].href).toBe('blob:mock-backup')
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-backup')
      expect(deps.applyImport).not.toHaveBeenCalled()
      expect(deps.clearAllData).not.toHaveBeenCalled()
    })

    it('reports an invalid current state with its issues and no download', async () => {
      const user = setupUser()
      const deps = dependencies({
        serializeExport: vi.fn(async () => {
          throw new DataTransferError('export_state_invalid', 'invalid', {
            validationIssues: [{ path: 'targetWeapons[0].idealBonuses', code: 'invalid_reference', message: 'Unknown bonus type.' }],
          })
        }),
      })
      render(<SettingsPage dependencies={deps} />)
      await user.click(exportButton())
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('現在の保存データに整合性の問題があるため、エクスポートできませんでした。')
      expect(alert).toHaveTextContent('保存済みデータは変更されていません。')
      const issues = within(alert).getByRole('list', { name: '検出された問題' })
      expect(within(issues).getByRole('listitem')).toHaveTextContent('targetWeapons[0].idealBonuses: Unknown bonus type.')
      expect(hasMaxHeightRule(issues)).toBe(true)
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(clickedAnchors).toHaveLength(0)
      expect(screen.queryByText('バックアップファイルをエクスポートしました。')).toBeNull()
      expect(exportButton()).toBeEnabled()
    })

    it('reports a read failure and an unexpected failure without a stack trace', async () => {
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
    })
  })

  describe('Import preparation', () => {
    it('opens the file input from the Import button and accepts JSON files', async () => {
      const user = setupUser()
      render(<SettingsPage dependencies={dependencies()} />)
      const input = fileInput()
      expect(input).toHaveAttribute('type', 'file')
      expect(input).toHaveAttribute('accept', '.json,application/json')
      const inputClick = vi.spyOn(input, 'click')
      await user.click(importButton())
      expect(inputClick).toHaveBeenCalledTimes(1)
    })

    it('hands the file text to prepareImportJson and opens the full-replacement confirmation', async () => {
      const user = setupUser()
      const deps = dependencies()
      render(<SettingsPage dependencies={deps} />)
      const json = JSON.stringify(exportRootWith(true))
      await selectBackup(user, json)
      const dialog = await screen.findByRole('dialog', { name: 'バックアップからデータを復元しますか？' })
      expect(deps.prepareImportJson).toHaveBeenCalledTimes(1)
      expect(deps.prepareImportJson).toHaveBeenCalledWith(json)
      expect(dialog).toHaveTextContent('このインポートは全置換です。現在保存されているデータは、選択したバックアップの内容に置き換わります。')
      expect(dialog).toHaveTextContent('必要な場合は、実行前に現在のデータをエクスポートしてください。')
      expect(dialog).toHaveAttribute('aria-labelledby')
      expect(dialog).toHaveAttribute('aria-describedby')
      expect(deps.applyImport).not.toHaveBeenCalled()
    })

    it.each([
      ['invalid_json' as const, '選択したファイルをJSONとして読み取れませんでした。', 'JSONとして読み取れません: bad'],
      ['invalid_import' as const, 'このバックアップファイルはインポートできません。', 'schemaVersion: Unsupported schemaVersion.'],
    ])('refuses %s with the error, no dialog and no apply', async (code, message, issueText) => {
      const user = setupUser()
      const issue = code === 'invalid_json'
        ? { path: '', code: 'invalid_structure' as const, message: 'JSONとして読み取れません: bad' }
        : { path: 'schemaVersion', code: 'invalid_literal' as const, message: 'Unsupported schemaVersion.' }
      const deps = dependencies({
        prepareImportJson: vi.fn((): ImportPreparationResult => ({ ok: false, code, issues: [issue] })),
      })
      render(<SettingsPage dependencies={deps} />)
      await selectBackup(user, '{not json')
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(message)
      expect(within(alert).getByRole('listitem')).toHaveTextContent(issueText)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(deps.applyImport).not.toHaveBeenCalled()
      expect(useSettingsStore.getState().isHydrated).toBe(false)
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
      await screen.findByRole('alert')
      expect((fileInput() as HTMLInputElement).value).toBe('')
      await selectBackup(user, '{not json')
      await screen.findByRole('dialog')
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
      expect(fileInput()).toBeDisabled()
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
      await screen.findByText('バックアップファイルをエクスポートしました。')
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
