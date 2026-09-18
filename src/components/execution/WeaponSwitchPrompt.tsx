import { Alert, AlertTitle, Button, Stack, Typography } from '@mui/material'

/**
 * The presentation-only weapon switch guidance (`docs/UI_FLOW.md` 12.6).
 *
 * 「武器を切り替えました」 only reveals the current Step's actions: it confirms
 * no Step, changes no Counter, weapon or ExecutionHistory, and is never
 * persisted, so a reload shows it again.
 */
export function WeaponSwitchPrompt({
  weaponLabel,
  onAcknowledge,
}: {
  weaponLabel: string
  onAcknowledge(): void
}) {
  return (
    <Alert severity="info" icon={false} role="region" aria-label="武器切替案内">
      <AlertTitle>武器の切替</AlertTitle>
      <Stack spacing={1.5}>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          作業する武器を「{weaponLabel}」へ切り替えてください
        </Typography>
        <Button
          variant="contained"
          size="large"
          onClick={onAcknowledge}
          sx={{ minHeight: 48, width: { xs: '100%', sm: 'auto' }, alignSelf: { sm: 'flex-start' } }}
        >
          武器を切り替えました
        </Button>
      </Stack>
    </Alert>
  )
}
