import { useId, type ReactNode } from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'

/**
 * One registered entity (an owned weapon or a Target weapon) in a management
 * list.
 *
 * A single DOM structure serves both devices (`docs/UI_FLOW.md` 3.1): the grid
 * stacks into a card on a smartphone, uses two columns from `md`, and becomes a
 * table-like row from `lg` where the content column is wide enough. Nothing is
 * rendered twice and hidden with CSS, so every control is exposed exactly once
 * to assistive technology. The edit / delete buttons keep their short visible
 * names and are described by the entity heading, so a screen reader can tell
 * which entity they act on.
 */
export function ManagementListItem({
  title,
  badges,
  summary,
  detail,
  status,
  muted = false,
  onEdit,
  onDelete,
}: {
  title: string
  badges?: ReactNode
  summary?: ReactNode
  detail: ReactNode
  status: ReactNode
  muted?: boolean
  onEdit(): void
  onDelete(): void
}) {
  const headingId = useId()
  return (
    <Box
      component="li"
      aria-labelledby={headingId}
      sx={{
        listStyle: 'none',
        px: { xs: 2, md: 2.5 },
        py: 2,
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: muted ? 'background.default' : 'background.paper',
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          md: 'repeat(2, minmax(0, 1fr))',
          lg: 'minmax(0, 1.05fr) minmax(0, 1.9fr) minmax(0, 1.25fr) auto',
        },
        gridTemplateAreas: {
          xs: '"identity" "detail" "status" "actions"',
          md: '"identity status" "detail detail" "actions actions"',
          lg: '"identity detail status actions"',
        },
        columnGap: 3,
        rowGap: 1.5,
        alignItems: 'start',
      }}
    >
      <Stack spacing={0.75} sx={{ gridArea: 'identity', minWidth: 0 }}>
        <Typography id={headingId} component="h3" variant="h3" sx={{ overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {badges && (
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {badges}
          </Stack>
        )}
        {summary}
      </Stack>
      <Box sx={{ gridArea: 'detail', minWidth: 0 }}>{detail}</Box>
      <Box sx={{ gridArea: 'status', minWidth: 0 }}>{status}</Box>
      <Stack
        direction={{ xs: 'row', lg: 'column' }}
        spacing={1}
        sx={{ gridArea: 'actions', justifyContent: { md: 'flex-end' } }}
      >
        <Button
          variant="outlined"
          onClick={onEdit}
          aria-describedby={headingId}
          sx={{ minHeight: 44, flex: { xs: 1, md: 'none' }, minWidth: 88 }}
        >
          編集
        </Button>
        <Button
          color="error"
          onClick={onDelete}
          aria-describedby={headingId}
          sx={{ minHeight: 44, flex: { xs: 1, md: 'none' }, minWidth: 88 }}
        >
          削除
        </Button>
      </Stack>
    </Box>
  )
}

/**
 * Five restoration bonus slots as an ordered list in stored slot order. The
 * slots are never sorted or grouped, and the key is the slot index because two
 * slots may legitimately hold the identical bonus.
 */
export function BonusSlotList({ heading, labels }: { heading: string; labels: readonly string[] }) {
  const headingId = useId()
  return (
    <Stack spacing={0.5}>
      <Typography id={headingId} variant="caption" color="text.secondary">
        {heading}
      </Typography>
      <Box
        component="ol"
        aria-labelledby={headingId}
        sx={{ m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
      >
        {labels.map((label, index) => (
          <Box
            component="li"
            key={`slot-${index}`}
            sx={{
              listStyle: 'none',
              display: 'flex',
              alignItems: 'baseline',
              gap: 0.5,
              minWidth: 0,
              maxWidth: '100%',
              px: 0.75,
              py: 0.25,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Typography component="span" variant="caption" color="text.secondary" className="tabular-nums">
              {index + 1}
            </Typography>
            <Typography component="span" variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Stack>
  )
}
