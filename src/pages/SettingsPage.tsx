import { Alert, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material'
import { useState } from 'react'
import { PageShell } from '../components/PageShell'
import { loadMasterData } from '../domain/master/loadMasterData'
import { productionRngRuntime } from '../domain/rng/production/productionRngRuntime'
import { settingsRepository } from '../db/settingsRepository'
import { useSettingsStore } from '../stores/settingsStore'

const masterData = loadMasterData()

export function SettingsPage() {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const setDebugMode = useSettingsStore((state) => state.setDebugMode)
  const [saveError, setSaveError] = useState(false)

  const handleDebugMode = (enabled: boolean) => {
    setDebugMode(enabled)
    setSaveError(false)
    void settingsRepository.setDebugMode(enabled).catch(() => setSaveError(true))
  }

  return (
    <PageShell title="設定" description="アプリの表示設定とバージョン情報を確認します。">
      <Stack spacing={2}>
        {saveError && <Alert severity="warning">設定を保存できませんでした。再度お試しください。</Alert>}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <FormControlLabel
            control={<Switch checked={debugMode} onChange={(_, checked) => handleDebugMode(checked)} />}
            label="デバッグモード"
          />
          <Typography variant="body2" color="text.secondary">
            表示だけを切り替えます。ゲーム計算の意味には影響しません。
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography component="h2" variant="h2" gutterBottom>
            バージョン情報
          </Typography>
          <Stack spacing={0.5}>
            {masterData.ok ? (
              <>
              <Typography>ゲームバージョン: {masterData.data.manifest.gameVersion === 'unknown-initial' ? '未確認' : masterData.data.manifest.gameVersion}</Typography>
              <Typography>マスターデータバージョン: {masterData.data.manifest.dataVersion}</Typography>
              <Typography>アプリスキーマバージョン: 1</Typography>
              </>
            ) : (
              <Alert severity="error">マスターデータを読み込めません。</Alert>
            )}
            <Typography>RNG予測エンジン: {productionRngRuntime.mode}</Typography>
            <Typography>Engine version: {productionRngRuntime.version}</Typography>
            <Typography>
              Seed Search: {productionRngRuntime.capabilities.supportsSeedSearch ? '対応' : '未対応'}
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </PageShell>
  )
}
