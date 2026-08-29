import type { ReactNode } from 'react'
import { Paper, Stack, Typography } from '@mui/material'

interface PageShellProps {
  title: string
  description: string
  children?: ReactNode
}

export function PageShell({ title, description, children }: PageShellProps) {
  return (
    <Stack spacing={3}>
      <header>
        <Typography component="h1" variant="h1" gutterBottom>
          {title}
        </Typography>
        <Typography color="text.secondary">{description}</Typography>
      </header>
      {children ?? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary">
            この画面の機能は、今後の実装タスクで追加します。
          </Typography>
        </Paper>
      )}
    </Stack>
  )
}
