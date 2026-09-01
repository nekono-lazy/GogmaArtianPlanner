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

export function DebugPage() {
  const debugMode = useSettingsStore((state) => state.debugMode)

  if (!debugMode) {
    return (
      <PageShell title="Debug Details" description="内部状態を確認する開発者向け画面です。">
        <Alert severity="info">Debug Modeが無効です。Settingsから有効にしてください。</Alert>
      </PageShell>
    )
  }

  return (
    <PageShell title="Debug Details" description="内部状態を確認する開発者向け画面です。">
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography component="h2" variant="h2" gutterBottom>RNG Engine information</Typography>
          <List aria-label="Production RNG Engine provenance" disablePadding>
            <ListItem divider><ListItemText primary="Engine mode" secondary={productionRngRuntime.mode} /></ListItem>
            <ListItem divider><ListItemText primary="Engine version" secondary={productionRngRuntime.version} /></ListItem>
            {capabilityRows.map(([name, supported]) => (
              <ListItem key={name} divider>
                <ListItemText primary={name} secondary={String(supported)} />
              </ListItem>
            ))}
          </List>
        </Paper>
        <Paper variant="outlined">
          <List aria-label="将来のDebug表示領域">
            {futureDebugSections.map((section) => (
              <ListItem key={section} divider>
                <ListItemText primary={section} secondary="データ接続は未実装です。" />
              </ListItem>
            ))}
          </List>
        </Paper>
      </Stack>
    </PageShell>
  )
}
