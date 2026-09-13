import { useId, type ReactNode } from 'react'
import { Alert, List, ListItem, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { PageShell } from '../components/PageShell'
import { productionRngRuntime } from '../domain/rng/production/productionRngRuntime'
import { useSettingsStore } from '../stores/settingsStore'

const futureDebugSections = [
  'Base Seed',
  'Gogma Counter',
  'Skill Counter',
  'Counter Gate',
  'Normal Artian Counter',
  'Planner internal information',
]

const capabilityRows = [
  ['supportsNormalArtianPrediction', productionRngRuntime.capabilities.supportsNormalArtianPrediction],
  ['supportsSkillPrediction', productionRngRuntime.capabilities.supportsSkillPrediction],
  ['supportsGogmaPrediction', productionRngRuntime.capabilities.supportsGogmaPrediction],
  ['supportsKeepBonusesPrediction', productionRngRuntime.capabilities.supportsKeepBonusesPrediction],
  ['supportsSeedSearch', productionRngRuntime.capabilities.supportsSeedSearch],
] as const

/** The raw flag plus its meaning, so a row never reads as a bare `true` / `false`. */
function capabilityValue(supported: boolean): string {
  return `${String(supported)}（${supported ? '対応' : '未対応'}）`
}

/** A titled, border-based developer section. Internal English names are allowed here. */
function DebugSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={headingId}
      sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}
    >
      <Typography id={headingId} component="h2" variant="h2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  )
}

/** Long identifiers and versions wrap inside the list instead of overflowing. */
const wrappingTextProps = {
  primary: { sx: { overflowWrap: 'anywhere' } },
  secondary: { sx: { overflowWrap: 'anywhere' } },
} as const

export function DebugPage() {
  const debugMode = useSettingsStore((state) => state.debugMode)

  if (!debugMode) {
    return (
      <PageShell title="Debug Details" description="内部状態を確認する開発者向け画面です。">
        <Alert severity="info">Debug Modeが無効です。「設定」画面のデバッグモードから有効にしてください。</Alert>
      </PageShell>
    )
  }

  return (
    <PageShell title="Debug Details" description="内部状態を確認する開発者向け画面です。">
      <Stack spacing={{ xs: 2, md: 3 }}>
        <DebugSection title="RNG Engine information">
          <List aria-label="Production RNG Engine provenance" disablePadding>
            <ListItem divider disableGutters>
              <ListItemText primary="Engine mode" secondary={productionRngRuntime.mode} slotProps={wrappingTextProps} />
            </ListItem>
            <ListItem divider disableGutters>
              <ListItemText primary="Engine version" secondary={productionRngRuntime.version} slotProps={wrappingTextProps} />
            </ListItem>
            {capabilityRows.map(([name, supported]) => (
              <ListItem key={name} divider disableGutters>
                <ListItemText primary={name} secondary={capabilityValue(supported)} slotProps={wrappingTextProps} />
              </ListItem>
            ))}
          </List>
        </DebugSection>
        <DebugSection title="Future debug sections">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            以下の内部状態はまだこの画面に接続されていません。
          </Typography>
          <List aria-label="将来のDebug表示領域" disablePadding>
            {futureDebugSections.map((section) => (
              <ListItem key={section} divider disableGutters>
                <ListItemText primary={section} secondary="データ接続は未実装です。" slotProps={wrappingTextProps} />
              </ListItem>
            ))}
          </List>
        </DebugSection>
      </Stack>
    </PageShell>
  )
}
