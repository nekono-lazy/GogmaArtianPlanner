import { Alert, Box, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material'
import { useId, useState, type ReactNode } from 'react'
import { PageShell } from '../components/PageShell'
import { loadMasterData } from '../domain/master/loadMasterData'
import { productionRngRuntime } from '../domain/rng/production/productionRngRuntime'
import { settingsRepository } from '../db/settingsRepository'
import { useSettingsStore } from '../stores/settingsStore'

const masterData = loadMasterData()

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

export function SettingsPage() {
  const debugMode = useSettingsStore((state) => state.debugMode)
  const setDebugMode = useSettingsStore((state) => state.setDebugMode)
  const [saveError, setSaveError] = useState(false)
  const debugHelpId = useId()

  const handleDebugMode = (enabled: boolean) => {
    setDebugMode(enabled)
    setSaveError(false)
    void settingsRepository.setDebugMode(enabled).catch(() => setSaveError(true))
  }

  return (
    <PageShell title="設定" description="アプリの表示設定とバージョン情報を確認します。">
      <Stack spacing={{ xs: 2, md: 3 }}>
        <SettingsSection title="表示設定">
          <FormControlLabel
            sx={{ m: 0, minHeight: 44 }}
            control={(
              <Switch
                checked={debugMode}
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
            <VersionRow
              label="Seed Search"
              value={productionRngRuntime.capabilities.supportsSeedSearch ? '対応' : '未対応'}
            />
          </Box>
        </SettingsSection>
      </Stack>
    </PageShell>
  )
}
