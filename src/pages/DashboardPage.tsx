import { Button, Card, CardActions, CardContent, Grid, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { PageShell } from '../components/PageShell'

const nextActions = [
  { title: 'RNG Setup', description: '予測に必要な状態を項目ごとに設定します。', to: '/rng' },
  { title: 'Owned Weapons', description: '所持している巨戟アーティアを管理します。', to: '/owned-weapons' },
  { title: 'Target Weapons', description: '欲しい完成武器の条件を登録します。', to: '/target-weapons' },
  { title: 'Search', description: '利用可能な経路から候補を検索します。', to: '/search' },
]

export function DashboardPage() {
  return (
    <PageShell
      title="Dashboard"
      description="準備状況を確認し、次に行う操作へ進みます。"
    >
      <Stack spacing={3}>
        <Card variant="outlined">
          <CardContent>
            <Typography component="h2" variant="h2" gutterBottom>
              Initial setup
            </Typography>
            <Typography color="text.secondary">
              現在はアプリ基盤のみ利用できます。ゲーム固有の予測・検索・Plannerは未実装です。
            </Typography>
          </CardContent>
        </Card>
        <Grid container spacing={2}>
          {nextActions.map((action) => (
            <Grid key={action.to} size={{ xs: 12, sm: 6 }}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Typography component="h2" variant="h2" gutterBottom>
                    {action.title}
                  </Typography>
                  <Typography color="text.secondary">{action.description}</Typography>
                </CardContent>
                <CardActions>
                  <Button component={RouterLink} to={action.to}>
                    開く
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Stack>
    </PageShell>
  )
}
