import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { PageShell } from '../components/PageShell'
import { ClearAllDataDialog } from '../components/settings/ClearAllDataDialog'
import { ImportConfirmDialog } from '../components/settings/ImportConfirmDialog'
import {
  clearFailedFeedback,
  clearSucceededFeedback,
  downloadJsonFile,
  EXPORT_DOWNLOAD_FILENAME,
  exportFailedFeedback,
  exportSucceededFeedback,
  importApplyFailedFeedback,
  importFileReadFailedFeedback,
  importPreparationFailedFeedback,
  importSucceededFeedback,
  type DataTransferFeedback,
  type DataTransferOperation,
} from '../components/settings/dataTransferPresentation'
import { loadMasterData } from '../domain/master/loadMasterData'
import type { AppSettings, ExportRoot } from '../domain/models/publicTypes'
import { productionRngRuntime } from '../domain/rng/production/productionRngRuntime'
import {
  createImportExportService,
  type ImportPreparationResult,
} from '../services/dataTransfer/importExportService'
import {
  getProductionIdentificationAvailability,
  productionIdentificationUnavailableReasonLabels,
} from '../services/rngIdentification/productionIdentificationAvailability'
import { settingsRepository } from '../db/settingsRepository'
import { useSettingsStore } from '../stores/settingsStore'

const masterData = loadMasterData()

/**
 * The Application boundary of the Settings screen. Export / Import / clear are
 * the `ImportExportService` methods as they are (`docs/DATA_MODEL.md` 15.3):
 * the screen re-implements no validation, no migration and no write, and
 * `prepareImportJson()` alone decides whether a file is importable.
 */
export interface SettingsPageDependencies {
  serializeExport(): Promise<string>
  prepareImportJson(json: string): ImportPreparationResult
  applyImport(root: ExportRoot): Promise<void>
  clearAllData(): Promise<AppSettings>
  saveDebugMode(enabled: boolean): Promise<unknown>
}

/** A titled, border-based settings section (the Dashboard / RNG Setup pattern). */
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={headingId}
      sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}
    >
      <Typography id={headingId} component="h2" variant="h2" sx={{ mb: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  )
}

/** One titled group inside the data management section. */
function DataManagementGroup({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ minWidth: 0 }}>
      <Typography id={headingId} component="h3" variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

/**
 * One label / value row of the version information. Values are shown exactly
 * as their authorities report them; a long Engine version wraps instead of
 * overflowing a narrow screen.
 */
function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) minmax(0, 1.4fr)' },
        columnGap: 2,
        rowGap: 0.25,
        py: 1,
        borderTop: 1,
        borderColor: 'divider',
        '&:first-of-type': { borderTop: 0, pt: 0 },
      }}
    >
      <Typography component="dt" variant="body2" sx={{ fontWeight: 500, minWidth: 0 }}>
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </Box>
  )
}

/**
 * The one outcome of the last data management operation. Success and failure
 * never show at once. A long validation issue list scrolls inside a bounded
 * region so the buttons below stay reachable (`docs/UI_FLOW.md` 3.1); nothing
 * is truncated.
 */
function DataTransferFeedbackAlert({ feedback }: { feedback: DataTransferFeedback }) {
  return (
    <Alert severity={feedback.severity} sx={{ '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' } }}>
      {feedback.message}
      {feedback.issues.length > 0 && (
        <Box
          component="ul"
          aria-label="検出された問題"
          tabIndex={0}
          sx={{ m: 0, mt: 1, pl: 2.5, maxHeight: { xs: 'min(24vh, 160px)', sm: 'min(28vh, 220px)' }, overflowY: 'auto' }}
        >
          {feedback.issues.map((issue, index) => (
            <Typography component="li" variant="body2" key={`${index}-${issue}`}>
              {issue}
            </Typography>
          ))}
        </Box>
      )}
    </Alert>
  )
}

/** The file input stays in the accessibility tree; the button beside it is its visible control. */
const visuallyHiddenInputStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

const actionButtonSx = { minHeight: 44, width: { xs: '100%', sm: 'auto' } } as const

export function SettingsPage({ dependencies }: { dependencies?: SettingsPageDependencies }) {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const setDebugMode = useSettingsStore((state) => state.setDebugMode)
  const hydrate = useSettingsStore((state) => state.hydrate)
  const api = useMemo<SettingsPageDependencies | null>(() => {
    if (dependencies) return dependencies
    if (!masterData.ok) return null
    const service = createImportExportService(masterData.data)
    return {
      serializeExport: () => service.serializeExport(),
      prepareImportJson: (json) => service.prepareImportJson(json),
      applyImport: (root) => service.applyImport(root),
      clearAllData: () => service.clearAllData(),
      saveDebugMode: (enabled) => settingsRepository.setDebugMode(enabled),
    }
  }, [dependencies])

  const [saveError, setSaveError] = useState(false)
  // The Debug Mode save and the Data Transfer operations write or replace the
  // same settings record, so a Data Transfer never starts while a Debug Mode
  // save is pending, and the toggle is disabled while a Data Transfer runs.
  // Rapid Debug Mode toggles stay allowed as before (each one is saved; the
  // count of pending saves gates the Data Transfer). The refs mirror the state
  // so a second click in the same tick is refused too.
  const [pendingSettingsSaves, setPendingSettingsSaves] = useState(0)
  const pendingSettingsSavesRef = useRef(0)
  const [operation, setOperation] = useState<DataTransferOperation>(null)
  const operationRef = useRef<DataTransferOperation>(null)
  const [pendingImport, setPendingImport] = useState<ExportRoot | null>(null)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [feedback, setFeedback] = useState<DataTransferFeedback | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const debugHelpId = useId()
  const exportHelpId = useId()
  const importHelpId = useId()
  const clearHelpId = useId()
  const identificationAvailability = getProductionIdentificationAvailability()

  const dataTransferBusy = operation !== null
  const settingsSaving = pendingSettingsSaves > 0
  const dataManagementDisabled = api === null || dataTransferBusy || settingsSaving

  const beginOperation = useCallback((next: Exclude<DataTransferOperation, null>): boolean => {
    if (operationRef.current !== null || pendingSettingsSavesRef.current > 0) return false
    operationRef.current = next
    setOperation(next)
    setFeedback(null)
    return true
  }, [])
  const endOperation = useCallback(() => {
    operationRef.current = null
    setOperation(null)
  }, [])

  const handleDebugMode = (enabled: boolean) => {
    if (api === null || operationRef.current !== null) return
    pendingSettingsSavesRef.current += 1
    setPendingSettingsSaves((count) => count + 1)
    setDebugMode(enabled)
    setSaveError(false)
    void api
      .saveDebugMode(enabled)
      .catch(() => setSaveError(true))
      .finally(() => {
        pendingSettingsSavesRef.current -= 1
        setPendingSettingsSaves((count) => count - 1)
      })
  }

  const handleExport = async () => {
    if (api === null || !beginOperation('export')) return
    try {
      const json = await api.serializeExport()
      downloadJsonFile(json, EXPORT_DOWNLOAD_FILENAME)
      setFeedback(exportSucceededFeedback())
    } catch (error: unknown) {
      setFeedback(exportFailedFeedback(error))
    } finally {
      endOperation()
    }
  }

  const handleImportFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0] ?? null
    // Reset first, so the same file can be selected again for a retry.
    input.value = ''
    if (file === null || api === null || !beginOperation('import_prepare')) return
    let text: string
    try {
      text = await file.text()
    } catch {
      setFeedback(importFileReadFailedFeedback())
      endOperation()
      return
    }
    try {
      const prepared = api.prepareImportJson(text)
      if (prepared.ok) {
        setPendingImport(prepared.root)
      } else {
        setFeedback(importPreparationFailedFeedback(prepared))
      }
    } catch {
      setFeedback(importFileReadFailedFeedback())
    } finally {
      endOperation()
    }
  }

  const handleImportConfirm = async (root: ExportRoot) => {
    if (api === null || !beginOperation('import_apply')) return
    try {
      await api.applyImport(root)
      // The imported settings are the persisted ones now; never re-read a
      // default over them.
      hydrate(root.settings)
      setSaveError(false)
      setPendingImport(null)
      setFeedback(importSucceededFeedback())
    } catch (error: unknown) {
      setPendingImport(null)
      setFeedback(importApplyFailedFeedback(error))
    } finally {
      endOperation()
    }
  }

  const handleClearConfirm = async () => {
    if (api === null || !beginOperation('clear')) return
    try {
      const settings = await api.clearAllData()
      hydrate(settings)
      setSaveError(false)
      setClearDialogOpen(false)
      setFeedback(clearSucceededFeedback())
    } catch {
      setClearDialogOpen(false)
      setFeedback(clearFailedFeedback())
    } finally {
      endOperation()
    }
  }

  return (
    <PageShell title="設定" description="アプリの表示設定、データのバックアップと復元、バージョン情報を管理します。">
      <Stack spacing={{ xs: 2, md: 3 }}>
        <SettingsSection title="表示設定">
          <FormControlLabel
            sx={{ m: 0, minHeight: 44 }}
            control={(
              <Switch
                checked={debugMode}
                disabled={api === null || dataTransferBusy}
                onChange={(_, checked) => handleDebugMode(checked)}
                slotProps={{ input: { 'aria-describedby': debugHelpId } }}
              />
            )}
            label="デバッグモード"
          />
          <Typography id={debugHelpId} variant="body2" color="text.secondary">
            内部のRNG値やデバッグ画面の表示だけを切り替えます。ゲーム計算の意味には影響しません。
          </Typography>
          {saveError && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              設定を保存できませんでした。再読み込み後は保存済みの設定が使用され、現在の表示と異なる場合があります。再度お試しください。
            </Alert>
          )}
        </SettingsSection>
        <SettingsSection title="データ管理">
          <Stack spacing={2.5} divider={<Divider flexItem />}>
            {api === null && <Alert severity="error">マスターデータが利用できないため、データ管理は使用できません。</Alert>}
            {feedback !== null && <DataTransferFeedbackAlert feedback={feedback} />}
            <DataManagementGroup title="バックアップ">
              <Typography id={exportHelpId} variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                RNG状態、通常アーティアCounter、所持武器、目標武器、候補と作成リスト、生産計画、実行履歴、ゲーム内セーブ地点、設定を含む全ユーザーデータを1つのJSONファイルとして保存します。別の端末へ移行するときや、インポート・全削除の前の控えとして使用します。
              </Typography>
              <Button
                variant="contained"
                disabled={dataManagementDisabled}
                onClick={() => void handleExport()}
                aria-describedby={exportHelpId}
                sx={actionButtonSx}
              >
                {operation === 'export' ? 'エクスポート中…' : 'データをエクスポート'}
              </Button>
            </DataManagementGroup>
            <DataManagementGroup title="復元">
              <Typography id={importHelpId} variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                エクスポートしたJSONファイルを選択して復元します。インポートは全置換で、現在保存されているデータはすべてバックアップの内容に置き換わります。必要な場合は先に現在のデータをエクスポートしてください。内容は実行前に検証し、確認後にだけ置き換えます。
              </Typography>
              <Button
                variant="outlined"
                disabled={dataManagementDisabled}
                onClick={() => fileInputRef.current?.click()}
                aria-describedby={importHelpId}
                sx={actionButtonSx}
              >
                {operation === 'import_prepare' ? 'ファイルを確認中…' : operation === 'import_apply' ? 'インポート中…' : 'データをインポート'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                aria-label="バックアップファイルを選択"
                disabled={dataManagementDisabled}
                onChange={(event) => void handleImportFileSelected(event)}
                style={visuallyHiddenInputStyle}
              />
            </DataManagementGroup>
            <DataManagementGroup title="初期化">
              <Typography id={clearHelpId} variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                保存されているユーザーデータをすべて削除し、初期状態へ戻します。この操作は元に戻せません。必要なデータがある場合は先にエクスポートしてください。
              </Typography>
              <Button
                variant="outlined"
                color="error"
                disabled={dataManagementDisabled}
                onClick={() => setClearDialogOpen(true)}
                aria-describedby={clearHelpId}
                sx={actionButtonSx}
              >
                {operation === 'clear' ? '削除中…' : '全データを削除'}
              </Button>
            </DataManagementGroup>
          </Stack>
        </SettingsSection>
        <SettingsSection title="バージョン情報">
          {!masterData.ok && (
            <Alert severity="error" sx={{ mb: 1.5 }}>マスターデータを読み込めません。</Alert>
          )}
          <Box component="dl" aria-label="バージョン情報" sx={{ m: 0 }}>
            {masterData.ok && (
              <>
                <VersionRow
                  label="ゲームバージョン"
                  value={masterData.data.manifest.gameVersion === 'unknown-initial' ? '未確認' : masterData.data.manifest.gameVersion}
                />
                <VersionRow label="マスターデータバージョン" value={String(masterData.data.manifest.dataVersion)} />
                <VersionRow label="アプリスキーマバージョン" value="1" />
              </>
            )}
            <VersionRow label="RNG予測エンジン" value={productionRngRuntime.mode} />
            <VersionRow label="Engine version" value={productionRngRuntime.version} />
            {/* RNG同定 is the Identification Wizard availability, decided at the
                application level and never by an RngEngine capability flag
                (`docs/UI_FLOW.md` 5 / 14). */}
            <VersionRow
              label="RNG同定"
              value={identificationAvailability.isAvailable ? '利用可能' : `利用不可（${productionIdentificationUnavailableReasonLabels[identificationAvailability.reason]}）`}
            />
          </Box>
        </SettingsSection>
      </Stack>
      <ImportConfirmDialog
        root={pendingImport}
        submitting={operation === 'import_apply'}
        onCancel={() => {
          if (operation !== 'import_apply') setPendingImport(null)
        }}
        onConfirm={(root) => void handleImportConfirm(root)}
      />
      <ClearAllDataDialog
        open={clearDialogOpen}
        submitting={operation === 'clear'}
        onCancel={() => {
          if (operation !== 'clear') setClearDialogOpen(false)
        }}
        onConfirm={() => void handleClearConfirm()}
      />
    </PageShell>
  )
}
