import { useParams } from 'react-router-dom'
import { PageShell } from '../components/PageShell'

export function ExecutionNavigatorPage() {
  const { planId } = useParams()
  return <PageShell title="実行ナビゲーション" description={`作成計画（${planId ?? '未指定'}）を1操作ずつ進めます。`} />
}
