import { Alert, List, ListItem, ListItemText, Paper } from '@mui/material'
import { PageShell } from '../components/PageShell'
import { useSettingsStore } from '../stores/settingsStore'

const futureDebugSections = [
  'Base Seed',
  'Gogma Counter',
  'Skill Counter',
  'Counter Gate',
  'Normal Artian Counter',
  'RNG Engine information',
  'Planner internal information',
]

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
      <Paper variant="outlined">
        <List aria-label="将来のDebug表示領域">
          {futureDebugSections.map((section) => (
            <ListItem key={section} divider>
              <ListItemText primary={section} secondary="データ接続は未実装です。" />
            </ListItem>
          ))}
        </List>
      </Paper>
    </PageShell>
  )
}
