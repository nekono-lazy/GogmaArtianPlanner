import { Button } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { PageShell } from '../components/PageShell'

export function NotFoundPage() {
  return (
    <PageShell title="Page Not Found" description="指定された画面は見つかりませんでした。">
      <Button component={RouterLink} to="/" variant="contained">
        Dashboardへ戻る
      </Button>
    </PageShell>
  )
}
