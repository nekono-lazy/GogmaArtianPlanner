import { Button } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { PageShell } from '../components/PageShell'

export function NotFoundPage() {
  return (
    <PageShell title="ページが見つかりません" description="指定された画面は見つかりませんでした。">
      <Button component={RouterLink} to="/" variant="contained">
        ダッシュボードへ戻る
      </Button>
    </PageShell>
  )
}
