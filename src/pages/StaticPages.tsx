import { useParams } from 'react-router-dom'
import { PageShell } from '../components/PageShell'

export function ProductionPlanPage() {
  const { planId } = useParams()
  return <PageShell title="Production Plan" description={`作成計画（${planId ?? '未指定'}）の全体を確認します。`} />
}

export function ExecutionNavigatorPage() {
  const { planId } = useParams()
  return <PageShell title="Execution Navigator" description={`作成計画（${planId ?? '未指定'}）を1操作ずつ進めます。`} />
}
